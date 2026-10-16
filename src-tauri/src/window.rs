//! Main window lifecycle: on macOS closing the window only hides it, so the app
//! keeps syncing and notifying until the user quits with ⌘Q. Chat pop-outs are
//! `window.open` windows of the main webview (same JS context and Matrix client).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  utils::config::BackgroundThrottlingPolicy,
  webview::{NewWindowFeatures, NewWindowResponse},
  AppHandle, Manager, RunEvent, Runtime, Url, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
/// Label prefix of chat pop-out windows (`popout.ts` on the frontend).
pub const POPOUT_PREFIX: &str = "popout-";

static QUITTING: AtomicBool = AtomicBool::new(false);
static POPOUT_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Creates the main window from tauri.conf.json (`create: false` there): config
/// windows cannot get a `window.open` handler.
pub fn create_main<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let config = app
    .config()
    .app
    .windows
    .iter()
    .find(|w| w.label == MAIN)
    .cloned()
    .expect("main window missing in tauri.conf.json");
  let handle = app.clone();
  WebviewWindowBuilder::from_config(app, &config)?
    .on_new_window(move |url, features| open_popout(&handle, url, features))
    .build()?;
  Ok(())
}

/// `window.open("about:blank")` from the main webview: a native window sharing the
/// opener's WebKit configuration, so the opener can render into its document.
/// Anything else goes to the default browser.
fn open_popout<R: Runtime>(app: &AppHandle<R>, url: Url, features: NewWindowFeatures) -> NewWindowResponse<R> {
  if url.as_str() != "about:blank" {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
      let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    return NewWindowResponse::Deny;
  }
  let label = format!("{POPOUT_PREFIX}{}", POPOUT_COUNTER.fetch_add(1, Ordering::Relaxed));
  let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
    .window_features(features)
    .title("Myna")
    .min_inner_size(360.0, 420.0)
    // HTML5 drag and drop (files into the composer), like the main window.
    .disable_drag_drop_handler()
    .background_throttling(BackgroundThrottlingPolicy::Disabled)
    .on_document_title_changed(|window, title| {
      let _ = window.set_title(&title);
    });
  // Overlay title bar like the main window: the room header is the title bar,
  // with the traffic lights in a strip above the chat name.
  #[cfg(target_os = "macos")]
  let builder = builder
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .traffic_light_position(tauri::LogicalPosition::new(14.0, 14.0));
  match builder.build() {
    Ok(window) => NewWindowResponse::Create { window },
    Err(err) => {
      log::error!("pop-out window failed: {err}");
      NewWindowResponse::Deny
    }
  }
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window(MAIN) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
  // macOS apps stay running without windows; elsewhere only while the tray icon is there.
  let keep_running = cfg!(target_os = "macos") || tray_enabled();
  if keep_running && window.label() == MAIN && !QUITTING.load(Ordering::Relaxed) {
    if let WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();
      hide(window);
    }
  }
}

#[cfg(desktop)]
fn tray_enabled() -> bool {
  crate::tray::ENABLED.load(Ordering::Relaxed)
}

#[cfg(not(desktop))]
fn tray_enabled() -> bool {
  false
}

fn hide<R: Runtime>(window: &Window<R>) {
  // Hiding a fullscreen window leaves an empty black Space behind; leave fullscreen first.
  if window.is_fullscreen().unwrap_or(false) {
    let _ = window.set_fullscreen(false);
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(std::time::Duration::from_millis(800)).await;
      let _ = window.hide();
    });
  } else {
    let _ = window.hide();
  }
}

pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
  match event {
    RunEvent::ExitRequested { .. } => QUITTING.store(true, Ordering::Relaxed),
    #[cfg(target_os = "macos")]
    RunEvent::Reopen { .. } => show_main(app),
    _ => {
      let _ = app;
    }
  }
}

/// App Nap throttles timers and network of a hidden or occluded app, so the sync
/// long-poll stalls and notifications arrive late. Opt out for the whole process
/// lifetime (idle system sleep stays allowed).
#[cfg(target_os = "macos")]
pub fn disable_app_nap() {
  use objc2_foundation::{ns_string, NSActivityOptions, NSProcessInfo};

  let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
    NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
    ns_string!("Matrix sync and notifications"),
  );
  // Never ended: the activity has to last until the app quits.
  std::mem::forget(activity);
}

/// Safety net behind the frontend's link interception: the main webview and chat
/// pop-outs never navigate away from the app; web links open in the default browser instead.
pub fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("navigation-guard")
    .on_navigation(|webview, url| {
      let label = webview.label();
      let app_window = label == MAIN || label.starts_with(POPOUT_PREFIX);
      if !app_window || is_app_url(url) || is_embed_url(url) {
        return true;
      }
      if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = webview.app_handle().opener().open_url(url.as_str(), None::<&str>);
      }
      false
    })
    .build()
}

/// Hosts of the inline players in `link-preview.tsx` (`embedFor`). WebKit runs
/// iframe navigations through this guard too; the iframes are sandboxed without
/// `allow-top-navigation`, so these hosts can never replace the app itself.
const EMBED_HOSTS: &[&str] = &[
  "youtube-nocookie.com",
  "youtube.com",
  "google.com",
  "doubleclick.net",
  "spotify.com",
  "vimeo.com",
  "embed.music.apple.com",
];

fn is_embed_url(url: &Url) -> bool {
  url.scheme() == "https"
    && url.host_str().is_some_and(|host| {
      EMBED_HOSTS
        .iter()
        .any(|h| host == *h || host.strip_suffix(h).is_some_and(|rest| rest.ends_with('.')))
    })
}

fn is_app_url(url: &Url) -> bool {
  match url.scheme() {
    "tauri" | "about" | "blob" | "data" => true,
    // Dev server and the Windows/Android custom-protocol host.
    "http" | "https" => url
      .host_str()
      .is_some_and(|h| h == "localhost" || h == "127.0.0.1" || h.ends_with(".localhost")),
    _ => false,
  }
}

/// Mouse down on a chat pop-out's room header (its title bar): drags or, on a
/// double click, zooms the window the event belongs to. Tauri's drag region
/// script cannot do it: in a pop-out it always targets the main window. Sync
/// command, so it runs on the main thread while the mouse-down is the current event.
#[tauri::command]
pub fn title_bar_mouse_down(zoom: bool) {
  #[cfg(target_os = "macos")]
  unsafe {
    use objc2::{class, msg_send, runtime::AnyObject};

    let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
    let event: *mut AnyObject = msg_send![app, currentEvent];
    if event.is_null() {
      return;
    }
    let window: *mut AnyObject = msg_send![event, window];
    if window.is_null() {
      return;
    }
    if zoom {
      let _: () = msg_send![window, performZoom: std::ptr::null_mut::<AnyObject>()];
    } else {
      let _: () = msg_send![window, performWindowDragWithEvent: event];
    }
  }
  #[cfg(not(target_os = "macos"))]
  let _ = zoom;
}

/// Web inspector in release builds (Settings → Developer options): right click →
/// Inspect Element, and Safari's Develop menu. Debug builds always have it.
#[tauri::command]
pub fn set_web_inspector<R: Runtime>(window: tauri::WebviewWindow<R>, enabled: bool) {
  if cfg!(debug_assertions) {
    return;
  }
  #[cfg(target_os = "macos")]
  let _ = window.with_webview(move |webview| unsafe {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{ns_string, NSNumber};

    let wk = &*webview.inner().cast::<AnyObject>();
    // `inspectable` exists from macOS 13.3; older versions only need the preference.
    let responds: bool = msg_send![wk, respondsToSelector: objc2::sel!(setInspectable:)];
    if responds {
      let _: () = msg_send![wk, setInspectable: enabled];
    }
    let config: Retained<AnyObject> = msg_send![wk, configuration];
    let preferences: Retained<AnyObject> = msg_send![&*config, preferences];
    let value = NSNumber::new_bool(enabled);
    let _: () = msg_send![&*preferences, setValue: &*value, forKey: ns_string!("developerExtrasEnabled")];
  });
  #[cfg(not(target_os = "macos"))]
  let _ = (window, enabled);
}
