//! Menu bar / system tray icon: shows the unread count (macOS title), reopens the
//! window and quits. The frontend owns the state (labels, count, on/off) and pushes
//! it with `update_tray`; with the icon on, closing the window keeps the app running.

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Mutex,
};

use serde::Deserialize;
use tauri::{
  image::Image,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, Runtime, State,
};

use crate::window;

const TRAY_ID: &str = "main";
const OPEN_ID: &str = "tray-open";
const QUIT_ID: &str = "tray-quit";

/// Whether the tray icon is shown; read by the window close handler.
pub static ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct TrayState(Mutex<Option<TrayIcon>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUpdate {
  enabled: bool,
  open_label: String,
  quit_label: String,
  tooltip: String,
  /// Unread mentions and DMs; 0 hides the number.
  count: u32,
}

fn icon<R: Runtime>(app: &AppHandle<R>) -> Option<Image<'static>> {
  if cfg!(target_os = "macos") {
    // Monochrome template image: macOS tints it for light/dark menu bars.
    Image::from_bytes(include_bytes!("../icons/tray-template.png")).ok()
  } else {
    app.default_window_icon().map(|icon| icon.clone().to_owned())
  }
}

fn menu<R: Runtime>(app: &AppHandle<R>, update: &TrayUpdate) -> tauri::Result<Menu<R>> {
  Menu::with_items(
    app,
    &[
      &MenuItem::with_id(app, OPEN_ID, &update.open_label, true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, QUIT_ID, &update.quit_label, true, None::<&str>)?,
    ],
  )
}

fn build<R: Runtime>(app: &AppHandle<R>, update: &TrayUpdate) -> tauri::Result<TrayIcon<R>> {
  let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu(app, update)?)
    // macOS convention: a click opens the menu. Elsewhere a click opens the window.
    .show_menu_on_left_click(cfg!(target_os = "macos"))
    .icon_as_template(true)
    .tooltip(&update.tooltip)
    .on_menu_event(|app, event| match event.id().as_ref() {
      OPEN_ID => window::show_main(app),
      QUIT_ID => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if cfg!(target_os = "macos") {
        return;
      }
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        window::show_main(tray.app_handle());
      }
    });
  if let Some(icon) = icon(app) {
    builder = builder.icon(icon);
  }
  builder.build(app)
}

fn title(count: u32) -> Option<String> {
  (count > 0).then(|| if count > 99 { "99+".into() } else { count.to_string() })
}

#[tauri::command]
pub fn update_tray(app: AppHandle, state: State<'_, TrayState>, update: TrayUpdate) -> Result<(), String> {
  let mut slot = state.0.lock().map_err(|e| e.to_string())?;
  ENABLED.store(update.enabled, Ordering::Relaxed);
  if !update.enabled {
    if slot.take().is_some() {
      let _ = app.remove_tray_by_id(TRAY_ID);
    }
    return Ok(());
  }
  match slot.as_ref() {
    Some(tray) => {
      tray.set_menu(Some(menu(&app, &update).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
      tray.set_tooltip(Some(&update.tooltip)).map_err(|e| e.to_string())?;
    }
    None => *slot = Some(build(&app, &update).map_err(|e| e.to_string())?),
  }
  if let Some(tray) = slot.as_ref() {
    // Only macOS (and some Linux trays) show a title next to the icon.
    let _ = tray.set_title(title(update.count));
  }
  Ok(())
}

/// Launched by the login item: start in the background (tray / dock) without a window.
pub fn started_hidden() -> bool {
  std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

pub const AUTOSTART_ARG: &str = "--autostart";

pub fn hide_main_on_autostart<R: Runtime>(app: &AppHandle<R>) {
  if started_hidden() {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.hide();
    }
  }
}
