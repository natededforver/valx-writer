// ---------------------------------------------------------------------------
// OneDrive OAuth2 (PKCE) + Microsoft Graph sync, entirely from the Rust side.
//
// Deliberately no tokio: the loopback redirect catcher is a plain
// std::net::TcpListener polled non-blocking on its own thread, and every
// Graph call goes through reqwest's blocking client from inside a
// #[tauri::command] (Tauri already runs commands off the main thread).
// ponytail: this trades a bit of manual polling for skipping an entire async
// runtime dependency — worth it for a flow that runs once per sync click.
//
// TODO: set CLIENT_ID to your Azure App Registration's client id (public
// client / PKCE, redirect URI http://localhost:19836/callback, scopes
// Files.ReadWrite.All User.Read offline_access — see implementation_plan.md).
// ---------------------------------------------------------------------------

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri_plugin_opener::OpenerExt;

const CLIENT_ID: &str = "ebf5dbf5-99da-4f2b-a156-e1b4d50e27aa";
const REDIRECT_URI: &str = "http://localhost:19836/callback";
const REDIRECT_PORT: &str = "127.0.0.1:19836";
const SCOPES: &str = "Files.ReadWrite.All User.Read offline_access";
const AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
// Graph's app-scoped special folder — shows up in the OneDrive web portal
// under "My files" > Apps > <the app's Azure display name>, auto-created on
// first access. Not a bare root:/Valx folder — that would sit loose at the
// top level instead of grouped under Apps like every other Graph-connected
// app's data.
const GRAPH_ROOT: &str = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const SYNC_MANIFEST_FILE: &str = ".onedrive-sync.json";

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64, // unix ms
    #[serde(default)]
    account: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Deserialize)]
pub(crate) struct SyncArgs {
    root: String,
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
}

#[derive(Serialize)]
struct PulledFile {
    path: String,
    name: String,
    content: String,
}

#[derive(Serialize)]
pub(crate) struct SyncResult {
    pulled: Vec<PulledFile>,
    pushed: Vec<String>,
    conflicts: Vec<String>,
    new_tokens: Option<Tokens>,
}

// --- PKCE helpers ------------------------------------------------------------

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).expect("OS RNG unavailable");
    buf
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

// --- loopback callback catcher ------------------------------------------------

fn accept_callback(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).into_owned();
                let first_line = req.lines().next().unwrap_or("");
                let path = first_line.split_whitespace().nth(1).unwrap_or("");
                let query = path.splitn(2, '?').nth(1).unwrap_or("");
                let params: HashMap<String, String> =
                    url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();

                let ok = params.get("state").map(|s| s.as_str()) == Some(expected_state);
                let body = if ok {
                    "<html><body>Valx is connected to OneDrive — you can close this window.</body></html>"
                } else {
                    "<html><body>Sign-in failed (state mismatch) — close this window and try again.</body></html>"
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());

                if !ok {
                    return Err("OAuth state mismatch".to_string());
                }
                return params.get("code").cloned().ok_or_else(|| "no code in callback".to_string());
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("timed out waiting for sign-in".to_string());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn exchange(form: &[(&str, &str)]) -> Result<Tokens, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client.post(TOKEN_URL).form(form).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("token request failed: {}", resp.text().unwrap_or_default()));
    }
    let tok: TokenResponse = resp.json().map_err(|e| e.to_string())?;
    Ok(Tokens {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token.unwrap_or_default(),
        expires_at: now_ms() + tok.expires_in.saturating_mul(1000),
        account: None,
    })
}

#[derive(Deserialize)]
struct MeResponse {
    mail: Option<String>,
    #[serde(rename = "userPrincipalName")]
    user_principal_name: Option<String>,
}

// Best-effort — shown in Settings so the user can tell which account is
// connected. Failure here shouldn't fail the whole sign-in.
fn fetch_account_email(access_token: &str) -> Option<String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName")
        .bearer_auth(access_token)
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let me: MeResponse = resp.json().ok()?;
    me.mail.or(me.user_principal_name)
}

#[tauri::command]
pub(crate) fn start_oauth(app: tauri::AppHandle) -> Result<Tokens, String> {
    if CLIENT_ID.starts_with("TODO_") {
        return Err("OneDrive isn't configured yet — set CLIENT_ID in src-tauri/src/onedrive.rs".to_string());
    }
    let verifier = b64url(&random_bytes(32));
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = b64url(&random_bytes(16));

    let listener = TcpListener::bind(REDIRECT_PORT)
        .map_err(|e| format!("couldn't open the sign-in port ({REDIRECT_PORT}): {e}"))?;

    let authorize_url: String = url::form_urlencoded::Serializer::new(format!("{AUTH_URL}?"))
        .append_pair("client_id", CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .finish();

    app.opener().open_url(authorize_url, None::<&str>).map_err(|e| e.to_string())?;

    let code = accept_callback(&listener, &state)?;
    let mut tokens = exchange(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("code_verifier", &verifier),
    ])?;
    tokens.account = fetch_account_email(&tokens.access_token);
    Ok(tokens)
}

fn refresh(refresh_token: &str) -> Result<Tokens, String> {
    exchange(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ])
}

// --- Graph API -----------------------------------------------------------------

#[derive(Deserialize)]
struct GraphChildren {
    value: Vec<GraphItem>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

#[derive(Deserialize)]
struct GraphItem {
    id: String,
    name: String,
    #[serde(rename = "lastModifiedDateTime")]
    last_modified: String,
    folder: Option<serde_json::Value>,
    #[serde(rename = "@microsoft.graph.downloadUrl")]
    download_url: Option<String>,
}

struct RemoteItem {
    path: String,
    name: String,
    mtime_ms: u64,
    download_url: String,
}

fn rel_key(path: &str, name: &str) -> String {
    if path.is_empty() { name.to_string() } else { format!("{path}/{name}") }
}

fn join_rel(base: &str, name: &str) -> String {
    if base.is_empty() { name.to_string() } else { format!("{base}/{name}") }
}

// Minimal "YYYY-MM-DDTHH:MM:SS(.fff)?Z" -> unix ms. Graph always returns UTC.
fn parse_iso_ms(s: &str) -> u64 {
    if s.len() < 19 { return 0; }
    let get = |a: usize, b: usize| s.get(a..b).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
    let (y, mo, d) = (get(0, 4), get(5, 7) as u32, get(8, 10) as u32);
    let (h, mi, se) = (get(11, 13) as u64, get(14, 16) as u64, get(17, 19) as u64);
    // Howard Hinnant's days-from-civil, epoch-relative day count.
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = yy - era * 400;
    let mp = (mo as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days * 86400 + h as i64 * 3600 + mi as i64 * 60 + se as i64) * 1000).max(0) as u64
}

fn list_remote_dir(
    client: &reqwest::blocking::Client,
    token: &str,
    item_id: Option<&str>,
    rel_base: &str,
    out: &mut Vec<RemoteItem>,
) -> Result<(), String> {
    let mut next = Some(match item_id {
        None => format!("{GRAPH_ROOT}/children"),
        Some(id) => format!("https://graph.microsoft.com/v1.0/me/drive/items/{id}/children"),
    });
    while let Some(url) = next {
        let resp = client.get(&url).bearer_auth(token).send().map_err(|e| e.to_string())?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(()); // the Valx folder doesn't exist yet — first sync, nothing to pull
        }
        if !resp.status().is_success() {
            return Err(format!("Graph list failed: {}", resp.status()));
        }
        let page: GraphChildren = resp.json().map_err(|e| e.to_string())?;
        for item in page.value {
            if item.name.starts_with('.') { continue; }
            if item.folder.is_some() {
                let rel = join_rel(rel_base, &item.name);
                list_remote_dir(client, token, Some(&item.id), &rel, out)?;
            } else if let Some(download_url) = item.download_url {
                out.push(RemoteItem {
                    path: rel_base.to_string(),
                    name: item.name,
                    mtime_ms: parse_iso_ms(&item.last_modified),
                    download_url,
                });
            }
        }
        next = page.next_link;
    }
    Ok(())
}

fn download(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    resp.text().map_err(|e| e.to_string())
}

fn upload(client: &reqwest::blocking::Client, token: &str, key: &str, content: &str) -> Result<(), String> {
    // Graph auto-creates any missing parent folders on a path-addressed PUT.
    let encoded_path = key
        .split('/')
        .map(|seg| url::form_urlencoded::byte_serialize(seg.as_bytes()).collect::<String>())
        .collect::<Vec<_>>()
        .join("/");
    let url = format!("{GRAPH_ROOT}:/{encoded_path}:/content");
    let resp = client
        .put(&url)
        .bearer_auth(token)
        .body(content.to_string())
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("upload of {key} failed: {}", resp.status()));
    }
    Ok(())
}

fn delete_remote(client: &reqwest::blocking::Client, token: &str, key: &str) -> Result<(), String> {
    let encoded_path = key
        .split('/')
        .map(|seg| url::form_urlencoded::byte_serialize(seg.as_bytes()).collect::<String>())
        .collect::<Vec<_>>()
        .join("/");
    let url = format!("{GRAPH_ROOT}:/{encoded_path}");
    let resp = client.delete(&url).bearer_auth(token).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(format!("delete of {key} failed: {}", resp.status()));
    }
    Ok(())
}

// A plain-path sync (compare local vs remote mtime, pull/push whichever is
// newer) can't tell "never synced" apart from "synced, then deleted locally"
// — both look like "remote has it, local doesn't", so a naive version pulls
// deleted notes back down forever. This manifest remembers which keys we've
// already synced so a local delete/rename can propagate as a remote delete
// instead of resurrecting the old file next round.
// ponytail: local-delete → remote-delete only (one direction). Remote delete
// -> local delete isn't tracked; add if users report the reverse ghost.
fn manifest_path(root: &str) -> PathBuf {
    PathBuf::from(root).join(SYNC_MANIFEST_FILE)
}

fn load_manifest(root: &str) -> HashMap<String, u64> {
    std::fs::read_to_string(manifest_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_manifest(root: &str, manifest: &HashMap<String, u64>) {
    if let Ok(s) = serde_json::to_string(manifest) {
        let _ = std::fs::write(manifest_path(root), s);
    }
}

// mtime comparisons use a 2s slop: filesystem mtimes and Graph's
// lastModifiedDateTime don't share sub-second precision, so an unmodified
// round-trip must not look like a conflict in both directions.
const MTIME_SLOP_MS: u64 = 2000;

#[tauri::command]
pub(crate) fn sync_onedrive(args: SyncArgs) -> Result<SyncResult, String> {
    let (access_token, new_tokens) = if now_ms() + 60_000 >= args.expires_at {
        let t = refresh(&args.refresh_token)?;
        (t.access_token.clone(), Some(t))
    } else {
        (args.access_token.clone(), None)
    };

    let mut local_files = Vec::new();
    let mut local_folders = Vec::new();
    crate::walk(&PathBuf::from(&args.root), "", &mut local_files, &mut local_folders)
        .map_err(|e| e.to_string())?;
    // ponytail: binary notes (.docx) carry base64 in `content`; upload/download
    // here treat content as literal text bytes, which would corrupt them.
    // Excluded until sync goes through a binary-safe path.
    local_files.retain(|f| !f.binary);
    let local_by_key: HashMap<String, &crate::DiskFile> =
        local_files.iter().map(|f| (rel_key(&f.path, &f.name), f)).collect();

    let client = reqwest::blocking::Client::new();
    let mut remote = Vec::new();
    list_remote_dir(&client, &access_token, None, "", &mut remote)?;
    let remote_by_key: HashMap<String, &RemoteItem> =
        remote.iter().map(|r| (rel_key(&r.path, &r.name), r)).collect();

    let mut manifest = load_manifest(&args.root);

    let mut pulled = Vec::new();
    let mut conflicts = Vec::new();
    for item in &remote {
        let key = rel_key(&item.path, &item.name);
        if !local_by_key.contains_key(&key) && manifest.contains_key(&key) {
            // We synced this before and it's gone locally now — the user
            // deleted or renamed it. Remove the remote copy instead of
            // pulling a "new" duplicate back down.
            delete_remote(&client, &access_token, &key)?;
            manifest.remove(&key);
            continue;
        }
        let local_mtime = local_by_key.get(&key).and_then(|f| f.mtime).unwrap_or(0.0) as u64;
        if item.mtime_ms > local_mtime + MTIME_SLOP_MS {
            let content = download(&client, &item.download_url)?;
            pulled.push(PulledFile { path: item.path.clone(), name: item.name.clone(), content });
            if local_by_key.contains_key(&key) { conflicts.push(key.clone()); }
        }
        manifest.insert(key, item.mtime_ms);
    }

    let mut pushed = Vec::new();
    for f in &local_files {
        let key = rel_key(&f.path, &f.name);
        let local_mtime = f.mtime.unwrap_or(0.0) as u64;
        let remote_mtime = remote_by_key.get(&key).map(|r| r.mtime_ms).unwrap_or(0);
        if local_mtime > remote_mtime + MTIME_SLOP_MS {
            upload(&client, &access_token, &key, &f.content)?;
            pushed.push(key.clone());
        }
        manifest.insert(key, local_mtime.max(remote_mtime));
    }

    save_manifest(&args.root, &manifest);

    Ok(SyncResult { pulled, pushed, conflicts, new_tokens })
}
