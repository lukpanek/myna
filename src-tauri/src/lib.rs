mod cookie_login;
mod media;
mod notifications;
#[cfg(desktop)]
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();

  // Must be the first plugin: a second launch just brings the running app forward.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
    window::show_main(app);
  }));

  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec![tray::AUTOSTART_ARG]),
    ))
    .manage(tray::TrayState::default());

  #[cfg(desktop)]
  let builder = builder.plugin(
    tauri_plugin_window_state::Builder::default()
      // Visibility is not restored: the window may be hidden (closed to the dock) at quit.
      .with_state_flags(
        tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE,
      )
      .with_denylist(&["cookie-login"])
      .build(),
  );

  let app = builder
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_os::init())
    .plugin(window::navigation_guard())
    .manage(media::MediaState::default())
    .register_asynchronous_uri_scheme_protocol(media::SCHEME, |ctx, request, responder| {
      media::handle(ctx.app_handle().clone(), request, responder);
    })
    .invoke_handler(tauri::generate_handler![
      media::set_media_session,
      media::clear_media_session,
      cookie_login::open_cookie_login,
      notifications::notification_permission,
      notifications::native_notify,
      #[cfg(desktop)]
      tray::update_tray,
    ])
    .on_window_event(window::on_window_event)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      media::init(app.handle());
      #[cfg(desktop)]
      tray::hide_main_on_autostart(app.handle());
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(window::on_run_event);
}
