//! macOS notifications through `UNUserNotificationCenter`.
//!
//! tauri-plugin-notification posts through the deprecated `NSUserNotificationCenter`,
//! which never asks for permission and recent macOS drops its notifications silently.
//! The modern API only works from a signed `.app` bundle (it throws otherwise);
//! `pnpm tauri dev` gets one from `scripts/dev-runner.sh`. A bare binary keeps
//! using the plugin: the commands report `false` and the frontend falls back.
//!
//! Messages become communication notifications (an `INSendMessageIntent`): the
//! sender's avatar replaces the app icon, like in Messages. That needs the
//! `com.apple.developer.usernotifications.communication` entitlement (and so a
//! provisioning profile); without it the chat avatar comes along as an image
//! attachment on the right instead. Images are read from the `media://` cache.

#[cfg(target_os = "macos")]
mod mac {
  use std::path::{Path, PathBuf};
  use std::sync::{Mutex, Once};

  use block2::RcBlock;
  use objc2::rc::Retained;
  use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
  use objc2::{define_class, msg_send, AllocAnyThread};
  use objc2_foundation::{ns_string, NSArray, NSBundle, NSData, NSError, NSString, NSURL};
  use objc2_intents::{
    INImage, INInteraction, INInteractionDirection, INOutgoingMessageType, INPerson, INPersonHandle,
    INPersonHandleType, INSendMessageIntent, INSpeakableString,
  };
  use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAttachment,
    UNNotificationContent, UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationSound,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
  };

  define_class!(
    // SAFETY: NSObject has no subclassing requirements and the class does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "MynaNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
      // Without this macOS hides notifications while the app is frontmost.
      #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
      fn will_present(
        &self,
        _center: &UNUserNotificationCenter,
        _notification: &UNNotification,
        handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
      ) {
        handler.call((UNNotificationPresentationOptions::Banner
          | UNNotificationPresentationOptions::List
          | UNNotificationPresentationOptions::Sound,));
      }
    }
  );

  impl Delegate {
    fn new() -> Retained<Self> {
      let this = Self::alloc().set_ivars(());
      unsafe { msg_send![super(this), init] }
    }
  }

  pub fn available() -> bool {
    NSBundle::mainBundle().bundlePath().to_string().ends_with(".app")
  }

  fn center() -> Retained<UNUserNotificationCenter> {
    static DELEGATE: Once = Once::new();
    let center = UNUserNotificationCenter::currentNotificationCenter();
    DELEGATE.call_once(|| {
      let delegate = Delegate::new();
      center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
      // The delegate property is weak: keep it alive for the whole process.
      std::mem::forget(delegate);
    });
    center
  }

  /// Shows the system prompt on first use; afterwards resolves with the stored answer.
  pub async fn request_permission() -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // Scoped: the block is not Send and must not live across the await.
    {
      let tx = Mutex::new(Some(tx));
      let handler = RcBlock::new(move |granted: Bool, err: *mut NSError| {
        if let Some(err) = unsafe { err.as_ref() } {
          log::warn!("notification authorization failed: {}", err.localizedDescription());
        }
        if let Some(tx) = tx.lock().unwrap().take() {
          let _ = tx.send(granted.as_bool());
        }
      });
      center().requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &handler,
      );
    }
    rx.await.unwrap_or(false)
  }

  /// A cached image file and its content type.
  pub type Image = (PathBuf, String);

  pub struct Notice {
    pub title: String,
    pub body: String,
    pub sound: bool,
    /// Room id: groups notifications per chat.
    pub group: Option<String>,
    /// Chat avatar.
    pub image: Option<Image>,
    pub sender: Option<Sender>,
  }

  pub struct Sender {
    pub id: String,
    pub name: String,
    pub image: Option<Image>,
    /// Group chat name; `None` in DMs.
    pub conversation: Option<String>,
  }

  pub fn show(n: Notice) {
    let id = format!("{:x}", rand_id());
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&n.title));
    content.setBody(&NSString::from_str(&n.body));
    if n.sound {
      content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    if let Some(group) = &n.group {
      content.setThreadIdentifier(&NSString::from_str(group));
    }
    let communication = n.sender.as_ref().and_then(|sender| communication(&content, &n, sender));
    let content: Retained<UNNotificationContent> = match communication {
      Some(updated) => updated,
      None => {
        let image = n.image.as_ref().or(n.sender.as_ref().and_then(|s| s.image.as_ref()));
        if let Some(attachment) = image.and_then(|(path, mime)| attachment(&id, path, mime)) {
          content.setAttachments(&NSArray::from_retained_slice(&[attachment]));
        }
        content.into_super()
      }
    };
    let id = NSString::from_str(&id);
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    let handler = RcBlock::new(|err: *mut NSError| {
      if let Some(err) = unsafe { err.as_ref() } {
        log::warn!("notification delivery failed: {}", err.localizedDescription());
      }
    });
    center().addNotificationRequest_withCompletionHandler(&request, Some(&handler));
  }

  /// Rewrites the content as a message from `sender`. `None` when macOS refuses,
  /// most likely because the app lacks the communication entitlement.
  fn communication(
    content: &UNMutableNotificationContent,
    n: &Notice,
    sender: &Sender,
  ) -> Option<Retained<UNNotificationContent>> {
    let person = |id: &str, name: &str, image: Option<&Image>, is_me: bool| unsafe {
      let handle = INPersonHandle::initWithValue_type(
        INPersonHandle::alloc(),
        Some(&NSString::from_str(id)),
        INPersonHandleType::Unknown,
      );
      INPerson::initWithPersonHandle_nameComponents_displayName_image_contactIdentifier_customIdentifier_isMe(
        INPerson::alloc(),
        &handle,
        None,
        Some(&NSString::from_str(name)),
        image.and_then(in_image).as_deref(),
        None,
        Some(&NSString::from_str(id)),
        is_me,
      )
    };
    let from = person(&sender.id, &sender.name, sender.image.as_ref(), false);
    let group_name = sender
      .conversation
      .as_ref()
      .map(|name| unsafe { INSpeakableString::initWithSpokenPhrase(INSpeakableString::alloc(), &NSString::from_str(name)) });
    // macOS shows a group only with more than one recipient; the user stands in for the rest.
    let recipients = group_name
      .is_some()
      .then(|| NSArray::from_retained_slice(&[person("me", "", None, true), from.clone()]));
    let conversation = n.group.as_deref().map(NSString::from_str);
    let intent = unsafe {
      INSendMessageIntent::initWithRecipients_outgoingMessageType_content_speakableGroupName_conversationIdentifier_serviceName_sender_attachments(
        INSendMessageIntent::alloc(),
        recipients.as_deref(),
        INOutgoingMessageType::OutgoingMessageText,
        Some(&NSString::from_str(&n.body)),
        group_name.as_deref(),
        conversation.as_deref(),
        None,
        Some(&from),
        None,
      )
    };
    if group_name.is_some() {
      if let Some(image) = n.image.as_ref().and_then(in_image) {
        unsafe { intent.setImage_forParameterNamed(Some(&image), ns_string!("speakableGroupName")) };
      }
    }
    unsafe {
      let interaction = INInteraction::initWithIntent_response(INInteraction::alloc(), &intent, None);
      interaction.setDirection(INInteractionDirection::Incoming);
      interaction.donateInteractionWithCompletion(None);
    }
    let updated: Result<Retained<UNNotificationContent>, Retained<NSError>> =
      unsafe { msg_send![content, contentByUpdatingWithProvider: &*intent, error: _] };
    updated
      .inspect_err(|err| log::debug!("communication notification refused: {}", err.localizedDescription()))
      .ok()
  }

  fn in_image((path, _): &Image) -> Option<Retained<INImage>> {
    let bytes = std::fs::read(path).ok()?;
    Some(unsafe { INImage::imageWithImageData(&NSData::with_bytes(&bytes)) })
  }

  /// macOS moves attachment files into its own store, so it gets a copy of the cached
  /// file, named with an extension it can read the type from.
  fn attachment(id: &str, path: &Path, mime: &str) -> Option<Retained<UNNotificationAttachment>> {
    let ext = match mime {
      "image/png" => "png",
      "image/jpeg" => "jpg",
      "image/gif" => "gif",
      _ => return None,
    };
    let copy = std::env::temp_dir().join(format!("myna-notification-{id}.{ext}"));
    std::fs::copy(path, &copy).ok()?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(&copy.to_string_lossy()));
    let id = NSString::from_str(id);
    unsafe { UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(&id, &url, None) }
      .inspect_err(|err| {
        log::warn!("notification image rejected: {}", err.localizedDescription());
        let _ = std::fs::remove_file(&copy);
      })
      .ok()
  }

  fn rand_id() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
  }
}

/// `true` = granted, `false` = denied. `None` = the native path is unavailable; use the plugin.
#[tauri::command]
pub async fn notification_permission() -> Option<bool> {
  #[cfg(target_os = "macos")]
  if mac::available() {
    return Some(mac::request_permission().await);
  }
  None
}

/// Who wrote the message; see [`mac::Sender`].
#[derive(serde::Deserialize)]
pub struct NotifySender {
  id: String,
  name: String,
  /// `media://` path of the sender's avatar.
  image: Option<String>,
  conversation: Option<String>,
}

/// Returns `false` when the native path is unavailable and the plugin must send it instead.
/// Images are `media://` paths (`thumbnail/{server}/{mediaId}?…`).
#[tauri::command]
pub async fn native_notify(
  media: tauri::State<'_, crate::media::MediaState>,
  title: String,
  body: String,
  sound: bool,
  group: Option<String>,
  image: Option<String>,
  sender: Option<NotifySender>,
) -> Result<bool, ()> {
  #[cfg(target_os = "macos")]
  if mac::available() {
    let load = |path: Option<String>| {
      let media = &media;
      async move {
        match path {
          Some(path) => crate::media::cached_file(media, &path).await,
          None => None,
        }
      }
    };
    let image = load(image).await;
    let sender = match sender {
      Some(s) => Some(mac::Sender {
        image: load(s.image).await,
        id: s.id,
        name: s.name,
        conversation: s.conversation,
      }),
      None => None,
    };
    mac::show(mac::Notice { title, body, sound, group, image, sender });
    return Ok(true);
  }
  let _ = (media, title, body, sound, group, image, sender);
  Ok(false)
}
