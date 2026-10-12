//! macOS notifications through `UNUserNotificationCenter`.
//!
//! tauri-plugin-notification posts through the deprecated `NSUserNotificationCenter`,
//! which never asks for permission and recent macOS drops its notifications silently.
//! The modern API only works from a signed `.app` bundle (it throws otherwise);
//! `pnpm tauri dev` gets one from `scripts/dev-runner.sh`. A bare binary keeps
//! using the plugin: the commands report `false` and the frontend falls back.

#[cfg(target_os = "macos")]
mod mac {
  use std::sync::{Mutex, Once};

  use block2::RcBlock;
  use objc2::rc::Retained;
  use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
  use objc2::{define_class, msg_send, AllocAnyThread};
  use objc2_foundation::{NSBundle, NSError, NSString};
  use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
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

  pub fn show(title: &str, body: &str, sound: bool, group: Option<&str>) {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    if sound {
      content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    if let Some(group) = group {
      content.setThreadIdentifier(&NSString::from_str(group));
    }
    let id = NSString::from_str(&format!("{:x}", rand_id()));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    let handler = RcBlock::new(|err: *mut NSError| {
      if let Some(err) = unsafe { err.as_ref() } {
        log::warn!("notification delivery failed: {}", err.localizedDescription());
      }
    });
    center().addNotificationRequest_withCompletionHandler(&request, Some(&handler));
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

/// Returns `false` when the native path is unavailable and the plugin must send it instead.
#[tauri::command]
pub fn native_notify(title: String, body: String, sound: bool, group: Option<String>) -> bool {
  #[cfg(target_os = "macos")]
  if mac::available() {
    mac::show(&title, &body, sound, group.as_deref());
    return true;
  }
  let _ = (title, body, sound, group);
  false
}
