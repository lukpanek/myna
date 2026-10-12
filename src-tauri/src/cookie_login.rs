//! Cookie-based bridge logins (Meta, Google Messages, …): the user signs in to the
//! network's website in a separate window and we read the resulting cookies,
//! including HttpOnly ones that page script cannot see.

use std::{collections::HashMap, time::Duration};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const DEFAULT_USER_AGENT: &str =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LABEL: &str = "cookie-login";
const POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Deserialize)]
pub struct CookieSpec {
  name: String,
  domain: Option<String>,
}

/// Opens the login window and resolves with `name -> value` once every requested
/// cookie exists, or `None` when the user closes the window.
#[tauri::command]
pub async fn open_cookie_login<R: Runtime>(
  app: AppHandle<R>,
  url: String,
  user_agent: Option<String>,
  cookies: Vec<CookieSpec>,
  title: String,
) -> Result<Option<HashMap<String, String>>, String> {
  if let Some(existing) = app.get_webview_window(LABEL) {
    let _ = existing.unminimize();
    let _ = existing.set_focus();
    return Err("login_window_open".into());
  }
  let start: Url = url.parse().map_err(|_| "invalid_login_url".to_string())?;
  if !matches!(start.scheme(), "https" | "http") {
    return Err("invalid_login_url".into());
  }
  if cookies.is_empty() {
    return Err("no_cookies".into());
  }

  // Ephemeral data store: every login starts signed out and leaves nothing behind.
  let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(start.clone()))
    .title(title)
    .inner_size(1000.0, 760.0)
    .min_inner_size(480.0, 480.0)
    .center()
    .incognito(true);
  // Meta and Google reject the default embedded-webview user agent, so fall back to desktop Chrome.
  let ua = user_agent.as_deref().filter(|ua| !ua.is_empty()).unwrap_or(DEFAULT_USER_AGENT);
  builder = builder.user_agent(ua);
  let window = builder.build().map_err(|e| format!("login_window_failed: {e}"))?;

  let urls = lookup_urls(&start, &cookies);
  loop {
    tokio::time::sleep(POLL_INTERVAL).await;
    if app.get_webview_window(LABEL).is_none() {
      focus_main(&app);
      return Ok(None);
    }
    // Reading cookies blocks on the webview's thread (and deadlocks WebView2 on a sync path).
    let reader = window.clone();
    let urls = urls.clone();
    let found = tauri::async_runtime::spawn_blocking(move || read_cookies(&reader, &urls))
      .await
      .map_err(|e| e.to_string())?;
    if let Some(values) = match_cookies(&cookies, &found) {
      let _ = window.close();
      focus_main(&app);
      return Ok(Some(values));
    }
  }
}

/// The start page plus each requested cookie domain, since `cookies_for_url` only
/// returns cookies that would be sent to that exact URL.
fn lookup_urls(start: &Url, cookies: &[CookieSpec]) -> Vec<Url> {
  let mut urls = vec![start.clone()];
  for domain in cookies.iter().filter_map(|c| c.domain.as_deref()) {
    let host = domain.trim_start_matches('.');
    if let Ok(url) = Url::parse(&format!("https://{host}/")) {
      if !urls.contains(&url) {
        urls.push(url);
      }
    }
  }
  urls
}

/// `(name, domain, value)`; host-only cookies get the host they were read for.
fn read_cookies<R: Runtime>(window: &WebviewWindow<R>, urls: &[Url]) -> Vec<(String, String, String)> {
  let mut out = Vec::new();
  for url in urls {
    let host = url.host_str().unwrap_or_default().to_owned();
    let Ok(cookies) = window.cookies_for_url(url.clone()) else { continue };
    for cookie in cookies {
      let domain = cookie.domain().map(str::to_owned).unwrap_or_else(|| host.clone());
      out.push((cookie.name().to_owned(), domain, cookie.value().to_owned()));
    }
  }
  out
}

fn match_cookies(specs: &[CookieSpec], found: &[(String, String, String)]) -> Option<HashMap<String, String>> {
  let mut values = HashMap::new();
  for spec in specs {
    let wanted = spec.domain.as_deref().map(normalize_domain);
    let (_, _, value) = found.iter().find(|(name, domain, value)| {
      name == &spec.name
        && !value.is_empty()
        && wanted.as_deref().is_none_or(|wanted| {
          let domain = normalize_domain(domain);
          domain == wanted || domain.ends_with(&format!(".{wanted}"))
        })
    })?;
    values.insert(spec.name.clone(), value.clone());
  }
  Some(values)
}

fn normalize_domain(domain: &str) -> String {
  domain.trim_start_matches('.').to_ascii_lowercase()
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.set_focus();
  }
}
