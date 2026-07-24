// ---------------------------------------------------------------------------
// Valx desktop backend (Tauri 2). Two custom commands; everything else the
// renderer needs (dialogs, file writes, opening URLs/paths) goes through the
// official plugins from src/lib/desktop.ts.
//
//   read_directory     – one-IPC recursive workspace scan (note files + mtime),
//                        same contract as the old Electron fs:readDirectory:
//                        a missing root returns { missing: true } as data, but
//                        an error *during* the scan rejects — a failed read
//                        must never look like an empty directory (the renderer
//                        would tombstone every note it knows about).
//   set_workspace_root – extends the fs-plugin scope and the asset-protocol
//                        scope to the user-picked workspace folder at runtime,
//                        so note files can be written and /__media attachments
//                        can be served without a wide static scope.
// ---------------------------------------------------------------------------

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[cfg(windows)]
mod native_mark_as;
mod onedrive;

// Ordered (label, kind) pairs for the native "Mark as" submenu. The renderer
// owns the ordering/labels (creator → human authors → AI → Other Website) and
// pushes them here via set_mark_as_items whenever the Creators settings change;
// native_mark_as reads this to (re)build the menu on each right-click.
pub(crate) struct MarkAsItems(pub(crate) Arc<Mutex<Vec<(String, String)>>>);

fn default_mark_as_items() -> Vec<(String, String)> {
    vec![
        ("Me".into(), "me".into()),
        ("AI".into(), "ai".into()),
        ("Other Website…".into(), "web".into()),
    ]
}

#[tauri::command]
fn set_mark_as_items(state: tauri::State<MarkAsItems>, items: Vec<(String, String)>) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = items;
    }
}

#[derive(Serialize)]
pub(crate) struct DiskFile {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) mtime: Option<f64>,
    // true when `content` is base64 (binary formats — currently just .docx)
    // instead of lossy-UTF8 text. See BINARY_EXTS below.
    pub(crate) binary: bool,
}

#[derive(Serialize)]
struct DirListing {
    files: Vec<DiskFile>,
    folders: Vec<String>,
    missing: bool,
}

// Text note files Valx reads back as editable notes. Must stay in sync with
// the web reader regex in src/hooks/useFileSystem.ts and splitExt in
// src/lib/sync.ts.
const NOTE_EXTS: [&str; 16] = [
    "md", "markdown", "mdown", "mkd", "txt", "text", "html", "htm", "css", "js", "mjs", "cjs",
    "jsx", "ts", "tsx", "py",
];

// Binary formats read/written whole — currently just .docx (a zip package;
// mammoth on the JS side decodes it, generateDocx() re-encodes it on save).
const BINARY_EXTS: [&str; 1] = ["docx"];

fn ext_of(name: &str) -> Option<&str> {
    name.rsplit_once('.').map(|(_, e)| e)
}

fn is_note_file(name: &str) -> bool {
    ext_of(name).is_some_and(|e| NOTE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

fn is_binary_note_file(name: &str) -> bool {
    ext_of(name).is_some_and(|e| BINARY_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

pub(crate) fn walk(
    dir: &Path,
    base: &str,
    files: &mut Vec<DiskFile>,
    folders: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // hidden files/dirs (.trash, .attachments) are skipped
        }
        // '/' separators so ids match across platforms and the renderer.
        let rel = if base.is_empty() { name.clone() } else { format!("{base}/{name}") };
        let ft = entry.file_type()?;
        if ft.is_dir() {
            folders.push(rel.clone());
            walk(&entry.path(), &rel, files, folders)?;
        } else if ft.is_file() && (is_note_file(&name) || is_binary_note_file(&name)) {
            let binary = is_binary_note_file(&name);
            // Lossy UTF-8 (Node's utf-8 read never rejected either) for text
            // formats; binary formats (.docx) go through as base64 instead —
            // decoding a zip package as lossy UTF-8 would corrupt it. Either
            // way a real IO error still propagates and fails the whole scan.
            let bytes = fs::read(entry.path())?;
            let content = if binary {
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            } else {
                String::from_utf8_lossy(&bytes).into_owned()
            };
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64);
            files.push(DiskFile { name, path: base.to_string(), content, mtime, binary });
        }
    }
    Ok(())
}

#[tauri::command]
fn read_directory(root: String) -> Result<DirListing, String> {
    let p = PathBuf::from(&root);
    if !p.is_dir() {
        // Expected probe (.trash before anything was deleted) — data, not error.
        return Ok(DirListing { files: vec![], folders: vec![], missing: true });
    }
    let mut files = Vec::new();
    let mut folders = Vec::new();
    walk(&p, "", &mut files, &mut folders).map_err(|e| e.to_string())?;
    Ok(DirListing { files, folders, missing: false })
}

#[tauri::command]
fn set_workspace_root(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let path = PathBuf::from(&root);
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // A second desktop instance would fight over the workspace; focus the
    // existing window instead. Must be the first plugin registered.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(MarkAsItems(Arc::new(Mutex::new(default_mark_as_items()))))
        .invoke_handler(tauri::generate_handler![
            read_directory,
            set_workspace_root,
            set_mark_as_items,
            onedrive::start_oauth,
            onedrive::sync_onedrive,
        ])
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                let items = app.state::<MarkAsItems>().0.clone();
                native_mark_as::install(&window, items);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
