//! `media://` protocol: authenticated Matrix media with a disk cache.
//!
//!   media://localhost/thumbnail/{server}/{mediaId}?width=W&height=H&method=crop|scale
//!   media://localhost/download/{server}/{mediaId}
//!
//! `<img>`/`<video>` cannot send an Authorization header, so the token lives here.

use std::{
  collections::HashMap,
  fs,
  io::{Read, Seek, SeekFrom},
  path::{Path, PathBuf},
  sync::{Arc, Mutex, OnceLock, Weak},
  time::{Duration, Instant, SystemTime},
};

use sha2::{Digest, Sha256};
use tauri::{
  http::{header, Request, Response, StatusCode},
  AppHandle, Manager, Runtime, State,
};
use tokio::{io::AsyncWriteExt, sync::watch};

pub const SCHEME: &str = "media";

// The frontend renders media URLs before it hands us the session; `<img>` never retries.
const SESSION_WAIT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CACHE_BYTES: u64 = 1024 * 1024 * 1024;
// The protocol body is a Vec, so large ranges are capped; media elements ask for the rest.
const MAX_RANGE_CHUNK: u64 = 4 * 1024 * 1024;
const NEGATIVE_TTL: Duration = Duration::from_secs(300);
const MAX_THUMBNAIL_SIZE: u32 = 1600;

#[derive(Clone)]
struct Session {
  base_url: String,
  access_token: String,
}

pub struct MediaState {
  session: watch::Sender<Option<Session>>,
  client: reqwest::Client,
  cache_dir: OnceLock<PathBuf>,
  inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
  failures: Mutex<HashMap<String, (StatusCode, Instant)>>,
}

impl Default for MediaState {
  fn default() -> Self {
    let client = reqwest::Client::builder()
      .user_agent(concat!("Myna/", env!("CARGO_PKG_VERSION")))
      .connect_timeout(CONNECT_TIMEOUT)
      .read_timeout(READ_TIMEOUT)
      .build()
      .unwrap_or_default();
    Self {
      session: watch::Sender::new(None),
      client,
      cache_dir: OnceLock::new(),
      inflight: Mutex::new(HashMap::new()),
      failures: Mutex::new(HashMap::new()),
    }
  }
}

impl MediaState {
  async fn session(&self) -> Option<Session> {
    let mut rx = self.session.subscribe();
    let ready = tokio::time::timeout(SESSION_WAIT, rx.wait_for(Option::is_some)).await;
    match ready {
      Ok(Ok(session)) => session.clone(),
      _ => None,
    }
  }

  /// One lock per cache key, so concurrent requests for the same file fetch it once.
  fn gate(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = map.get(key).and_then(Weak::upgrade) {
      return gate;
    }
    let gate = Arc::new(tokio::sync::Mutex::new(()));
    map.insert(key.to_owned(), Arc::downgrade(&gate));
    gate
  }

  fn recent_failure(&self, key: &str) -> Option<StatusCode> {
    let mut map = self.failures.lock().unwrap_or_else(|e| e.into_inner());
    match map.get(key) {
      Some((status, at)) if at.elapsed() < NEGATIVE_TTL => Some(*status),
      Some(_) => {
        map.remove(key);
        None
      }
      None => None,
    }
  }

  /// Remembers definitive "this media does not exist" answers, so a missing avatar
  /// is not refetched on every render. Auth, rate-limit and server errors stay retryable.
  fn note_failure(&self, key: &str, status: StatusCode) {
    if matches!(
      status,
      StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND | StatusCode::GONE | StatusCode::PAYLOAD_TOO_LARGE
    ) {
      let mut map = self.failures.lock().unwrap_or_else(|e| e.into_inner());
      if map.len() > 1024 {
        map.clear();
      }
      map.insert(key.to_owned(), (status, Instant::now()));
    }
  }
}

#[tauri::command]
pub fn set_media_session(
  state: State<'_, MediaState>,
  base_url: String,
  access_token: String,
) -> Result<(), String> {
  let base_url = base_url.trim_end_matches('/').to_owned();
  if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
    return Err("invalid_homeserver".into());
  }
  state.failures.lock().unwrap_or_else(|e| e.into_inner()).clear();
  state.session.send_replace(Some(Session { base_url, access_token }));
  Ok(())
}

#[tauri::command]
pub fn clear_media_session(state: State<'_, MediaState>) {
  state.session.send_replace(None);
  state.failures.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// Resolves the cache directory and trims the cache in the background.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
  let Ok(dir) = app.path().app_cache_dir().map(|d| d.join("media")) else {
    log::warn!("media: no cache directory");
    return;
  };
  if let Err(err) = fs::create_dir_all(&dir) {
    log::warn!("media: cannot create cache directory: {err}");
    return;
  }
  let state = app.state::<MediaState>();
  let _ = state.cache_dir.set(dir.clone());
  tauri::async_runtime::spawn_blocking(move || evict(&dir, MAX_CACHE_BYTES));
}

/// Protocol entry point; answers asynchronously so slow downloads never block the webview.
pub fn handle<R: Runtime>(app: AppHandle<R>, request: Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
  tauri::async_runtime::spawn(async move {
    let response = if request.method() == tauri::http::Method::OPTIONS {
      empty(StatusCode::NO_CONTENT)
    } else {
      let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
      let state = app.state::<MediaState>();
      match serve(&state, &request, range).await {
        Ok(response) => response,
        Err(status) => empty(status),
      }
    };
    responder.respond(response);
  });
}

/// A validated media request.
struct Target {
  kind: Kind,
  server: String,
  media_id: String,
  /// Canonical upstream query (thumbnail parameters), also part of the cache key.
  query: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
  Thumbnail,
  Download,
}

impl Target {
  fn parse(uri: &tauri::http::Uri) -> Option<Self> {
    let mut parts = uri.path().trim_start_matches('/').split('/');
    let kind = match parts.next()? {
      "thumbnail" => Kind::Thumbnail,
      "download" => Kind::Download,
      _ => return None,
    };
    let server = parts.next()?;
    let media_id = parts.next()?;
    if parts.next().is_some() || !valid_server(server) || !valid_media_id(media_id) {
      return None;
    }
    let query = match kind {
      Kind::Download => String::new(),
      Kind::Thumbnail => {
        let params = parse_query(uri.query().unwrap_or(""));
        let size = |name: &str| {
          params
            .get(name)
            .and_then(|v| v.parse::<u32>().ok())
            .map(|v| v.clamp(1, MAX_THUMBNAIL_SIZE))
            .unwrap_or(96)
        };
        let method = match params.get("method").map(String::as_str) {
          Some("scale") => "scale",
          _ => "crop",
        };
        format!("width={}&height={}&method={method}", size("width"), size("height"))
      }
    };
    Some(Self {
      kind,
      server: server.to_owned(),
      media_id: media_id.to_owned(),
      query,
    })
  }

  fn cache_key(&self) -> String {
    let kind = match self.kind {
      Kind::Thumbnail => "thumbnail",
      Kind::Download => "download",
    };
    format!("{kind}/{}/{}?{}", self.server, self.media_id, self.query)
  }

  fn upstream_url(&self, base: &str, kind: Kind, legacy: bool) -> String {
    let prefix = if legacy { "_matrix/media/v3" } else { "_matrix/client/v1/media" };
    match kind {
      Kind::Thumbnail => format!(
        "{base}/{prefix}/thumbnail/{}/{}?{}&animated=true",
        self.server, self.media_id, self.query
      ),
      Kind::Download => format!("{base}/{prefix}/download/{}/{}", self.server, self.media_id),
    }
  }
}

fn valid_server(s: &str) -> bool {
  !s.is_empty()
    && s.len() <= 255
    && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b':' | b'[' | b']'))
}

// The id arrives percent-encoded and is forwarded as-is; only reject path tricks.
fn valid_media_id(s: &str) -> bool {
  !s.is_empty()
    && s != "."
    && s != ".."
    && s.len() <= 255
    && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'%' | b'-' | b'_' | b'.' | b'~' | b'='))
}

fn parse_query(query: &str) -> HashMap<String, String> {
  query
    .split('&')
    .filter_map(|pair| pair.split_once('='))
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect()
}

struct CacheEntry {
  body: PathBuf,
  content_type: String,
}

fn cache_paths(dir: &Path, key: &str) -> (PathBuf, PathBuf) {
  let hash = hex::encode(Sha256::digest(key.as_bytes()));
  (dir.join(&hash), dir.join(format!("{hash}.type")))
}

fn read_cached(dir: &Path, key: &str) -> Option<CacheEntry> {
  let (body, sidecar) = cache_paths(dir, key);
  if !body.is_file() {
    return None;
  }
  let content_type = fs::read_to_string(sidecar)
    .ok()
    .filter(|t| !t.is_empty())
    .unwrap_or_else(|| "application/octet-stream".into());
  Some(CacheEntry { body, content_type })
}

async fn serve(
  state: &MediaState,
  request: &Request<Vec<u8>>,
  range: Option<String>,
) -> Result<Response<Vec<u8>>, StatusCode> {
  let target = Target::parse(request.uri()).ok_or(StatusCode::BAD_REQUEST)?;
  let dir = state.cache_dir.get().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?.clone();
  let key = target.cache_key();

  let entry = match read_cached(&dir, &key) {
    Some(entry) => entry,
    None => {
      if let Some(status) = state.recent_failure(&key) {
        return Err(status);
      }
      let gate = state.gate(&key);
      let _guard = gate.lock().await;
      // Another request may have filled the cache while we waited for the gate.
      match read_cached(&dir, &key) {
        Some(entry) => entry,
        None => match fetch(state, &target, &dir, &key).await {
          Ok(entry) => entry,
          Err(status) => {
            state.note_failure(&key, status);
            return Err(status);
          }
        },
      }
    }
  };

  tauri::async_runtime::spawn_blocking(move || read_response(&entry, range.as_deref()))
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

async fn fetch(state: &MediaState, target: &Target, dir: &Path, key: &str) -> Result<CacheEntry, StatusCode> {
  let session = state.session().await.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
  let result = request_upstream(state, &session, target, target.kind).await;
  let mut response = match result {
    // Servers refuse to thumbnail some files (or lack a thumbnail); show the original instead.
    Err(StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND) if target.kind == Kind::Thumbnail => {
      request_upstream(state, &session, target, Kind::Download).await
    }
    other => other,
  }
  .inspect_err(|status| log::debug!("media: {key} -> {status}"))?;

  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("application/octet-stream")
    .to_owned();
  let (body_path, sidecar) = cache_paths(dir, key);
  let part = body_path.with_extension("part");
  if let Err(err) = write_body(&mut response, &part).await {
    log::debug!("media: {key} download failed: {err}");
    let _ = tokio::fs::remove_file(&part).await;
    return Err(StatusCode::BAD_GATEWAY);
  }
  // Sidecar first: a present body file always means a complete entry.
  tokio::fs::write(&sidecar, content_type.as_bytes())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  tokio::fs::rename(&part, &body_path)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  Ok(CacheEntry {
    body: body_path,
    content_type,
  })
}

/// Authenticated media first (MSC3916); servers that predate it get the legacy endpoint.
/// Any non-success status becomes `Err`.
async fn request_upstream(
  state: &MediaState,
  session: &Session,
  target: &Target,
  kind: Kind,
) -> Result<reqwest::Response, StatusCode> {
  let response = state
    .client
    .get(target.upstream_url(&session.base_url, kind, false))
    .bearer_auth(&session.access_token)
    .send()
    .await
    .map_err(|_| StatusCode::BAD_GATEWAY)?;
  let status = response.status();
  if status.is_success() {
    return Ok(response);
  }
  if !matches!(status.as_u16(), 400 | 404 | 405) {
    return Err(to_status(status));
  }
  let body = response.bytes().await.unwrap_or_default();
  let unrecognized = serde_json::from_slice::<serde_json::Value>(&body)
    .ok()
    .is_some_and(|v| v.get("errcode").and_then(|c| c.as_str()) == Some("M_UNRECOGNIZED"));
  if !unrecognized {
    return Err(to_status(status));
  }
  let legacy = state
    .client
    .get(target.upstream_url(&session.base_url, kind, true))
    .send()
    .await
    .map_err(|_| StatusCode::BAD_GATEWAY)?;
  if legacy.status().is_success() {
    Ok(legacy)
  } else {
    Err(to_status(legacy.status()))
  }
}

fn to_status(status: reqwest::StatusCode) -> StatusCode {
  StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
}

async fn write_body(response: &mut reqwest::Response, path: &Path) -> Result<(), String> {
  let mut file = tokio::fs::File::create(path).await.map_err(|e| e.to_string())?;
  while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
  }
  file.flush().await.map_err(|e| e.to_string())
}

fn read_response(entry: &CacheEntry, range: Option<&str>) -> Result<Response<Vec<u8>>, StatusCode> {
  let mut file = fs::File::open(&entry.body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  let total = file.metadata().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.len();

  let Some(range) = range else {
    let mut body = Vec::with_capacity(total as usize);
    file.read_to_end(&mut body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    return Ok(media_response(StatusCode::OK, &entry.content_type, body, None));
  };

  let Some((start, end)) = parse_range(range, total) else {
    let mut response = empty(StatusCode::RANGE_NOT_SATISFIABLE);
    if let Ok(value) = format!("bytes */{total}").parse() {
      response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    return Ok(response);
  };
  let mut body = vec![0; (end - start + 1) as usize];
  file.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  file.read_exact(&mut body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  Ok(media_response(
    StatusCode::PARTIAL_CONTENT,
    &entry.content_type,
    body,
    Some(format!("bytes {start}-{end}/{total}")),
  ))
}

/// Single `bytes=` range, clamped to the file and to `MAX_RANGE_CHUNK`.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
  if total == 0 {
    return None;
  }
  let spec = header.trim().strip_prefix("bytes=")?;
  let spec = spec.split(',').next()?.trim();
  let (start, end) = spec.split_once('-')?;
  let (start, end) = if start.is_empty() {
    let suffix = end.parse::<u64>().ok().filter(|&n| n > 0)?.min(total);
    (total - suffix, total - 1)
  } else {
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() { total - 1 } else { end.parse::<u64>().ok()?.min(total - 1) };
    (start, end)
  };
  if start > end || start >= total {
    return None;
  }
  Some((start, end.min(start + MAX_RANGE_CHUNK - 1)))
}

fn media_response(
  status: StatusCode,
  content_type: &str,
  body: Vec<u8>,
  content_range: Option<String>,
) -> Response<Vec<u8>> {
  let mut response = empty(status);
  let len = body.len();
  *response.body_mut() = body;
  let headers = response.headers_mut();
  if let Ok(value) = content_type.parse() {
    headers.insert(header::CONTENT_TYPE, value);
  }
  if let Some(value) = content_range.and_then(|r| r.parse().ok()) {
    headers.insert(header::CONTENT_RANGE, value);
  }
  headers.insert(header::CONTENT_LENGTH, len.into());
  headers.insert(header::ACCEPT_RANGES, header::HeaderValue::from_static("bytes"));
  headers.insert(
    header::CACHE_CONTROL,
    header::HeaderValue::from_static("max-age=31536000, immutable"),
  );
  // Media is untrusted: never let it run script if it is ever opened as a document.
  headers.insert(
    header::CONTENT_SECURITY_POLICY,
    header::HeaderValue::from_static("sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'"),
  );
  response
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
  let mut response = Response::new(Vec::new());
  *response.status_mut() = status;
  response
    .headers_mut()
    .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, header::HeaderValue::from_static("*"));
  response
}

/// Drops the oldest cache files until the cache fits in `cap` bytes; also clears
/// partial downloads left by a crash.
fn evict(dir: &Path, cap: u64) {
  let Ok(read_dir) = fs::read_dir(dir) else { return };
  let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
  let mut total = 0;
  for entry in read_dir.flatten() {
    let path = entry.path();
    if path.extension().is_some_and(|e| e == "part") {
      let _ = fs::remove_file(&path);
      continue;
    }
    if path.extension().is_some() {
      continue; // sidecars go together with their body
    }
    let Ok(meta) = entry.metadata() else { continue };
    if !meta.is_file() {
      continue;
    }
    total += meta.len();
    files.push((path, meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
  }
  if total <= cap {
    return;
  }
  files.sort_by_key(|(_, _, modified)| *modified);
  let mut removed = 0u64;
  for (path, len, _) in files {
    if total <= cap {
      break;
    }
    if fs::remove_file(&path).is_ok() {
      let _ = fs::remove_file(path.with_extension("type"));
      total -= len;
      removed += len;
    }
  }
  log::info!("media: evicted {} MiB from cache", removed / (1024 * 1024));
}
