//! Main window lifecycle: on macOS closing the window only hides it, so the app
//! keeps syncing and notifying until the user quits with ⌘Q.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  AppHandle, Manager, RunEvent, Runtime, Url, Window, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";

static QUITTING: AtomicBool = AtomicBool::new(false);

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

/// Safety net behind the frontend's link interception: the main webview never
/// navigates away from the app; web links open in the default browser instead.
pub fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("navigation-guard")
    .on_navigation(|webview, url| {
      if webview.label() != MAIN || is_app_url(url) || is_embed_url(url) {
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
