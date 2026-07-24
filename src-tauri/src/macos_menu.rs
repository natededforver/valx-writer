// ---------------------------------------------------------------------------
// The macOS application menu.
//
// On Windows the app draws its own menu bar inside the window (Editor.tsx),
// because a borderless WebView2 window has nowhere else to put one. macOS has
// a system menu bar and users expect it to be populated — a Mac app with only
// Tauri's fallback menu is missing About/Preferences and reads as a port.
//
// The in-window menu bar stays on macOS too: it is the app's own File/Edit/
// Format/View surface, and the two are not redundant so much as differently
// scoped. What lives *here* is the set of commands macOS puts in the menu bar
// on every app — the ones ⌘Q/⌘H/⌘M/⌘, are muscle memory for — plus the
// standard editing verbs, which AppKit routes to the focused WKWebView for
// free (PredefinedMenuItem::cut/copy/paste act on the contentEditable without
// any IPC of ours).
//
// Only "Preferences…" needs wiring back to the renderer; it emits the same
// event App.tsx's ⌘, keydown handler already opens Settings on.
// ---------------------------------------------------------------------------

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event the renderer listens for to open the Settings modal (see App.tsx).
pub const OPEN_PREFERENCES_EVENT: &str = "menu://preferences";

/// Menu item id for Preferences…, matched in the on_menu_event handler.
const ID_PREFERENCES: &str = "preferences";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();

    // Bound to a local first: the parameter is Option<&str>, and Option<&String>
    // does not deref-coerce through the Some.
    let about_label = format!("About {name}");
    let about = PredefinedMenuItem::about(
        app,
        Some(about_label.as_str()),
        Some(AboutMetadata {
            name: Some(name.clone()),
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        }),
    )?;
    // CmdOrCtrl+, rather than Cmd+, so the accelerator string stays correct if
    // this menu is ever reused on another platform; on macOS it resolves to ⌘,.
    let preferences = MenuItem::with_id(
        app,
        ID_PREFERENCES,
        "Preferences…",
        true,
        Some("CmdOrCtrl+,"),
    )?;

    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &preferences,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // Undo/redo are the webview's own, which is what makes them correct: the
    // editor rides contentEditable's native undo stack (see the note on
    // Editor.tsx's editCmd) rather than a hand-rolled history.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // Native (green-button) fullscreen. Distinct from the app's own
    // distraction-free mode on F11/⌘↩, which only hides the app's chrome.
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    // maximize() is Zoom on macOS — the green button's windowed behaviour.
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

/// Install the menu and its one custom handler. A failure here is not fatal —
/// Tauri's fallback menu still gives ⌘Q — so this logs and moves on rather
/// than taking the app down during setup.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    match build(app) {
        Ok(menu) => {
            if let Err(e) = app.set_menu(menu) {
                eprintln!("macos_menu: set_menu failed: {e}");
                return;
            }
        }
        Err(e) => {
            eprintln!("macos_menu: build failed: {e}");
            return;
        }
    }
    app.on_menu_event(move |app, event| {
        if event.id().0.as_str() == ID_PREFERENCES {
            // Target the main window rather than broadcasting: the splash
            // window is a separate webview with no listener, and emitting at
            // it would be a no-op at best.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit(OPEN_PREFERENCES_EVENT, ());
            }
        }
    });
}
