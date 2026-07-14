// Splices a "Mark as" submenu into the OS's own right-click menu (Windows /
// WebView2 only), sitting alongside WebView2's native spellcheck suggestions
// and cut/copy/paste — instead of the JS-drawn bubble menu that previously
// had to live next to, not inside, the native menu (see the comment on
// RichTextEditor's handleContextMenu: an Electron-era attempt at a fully
// custom native menu killed spellcheck once ported to Tauri, so this hooks
// WebView2's own ContextMenuRequested COM event rather than replacing it).
//
// The renderer still computes *which* Range gets marked (selectionInEditor
// in RichTextEditor.tsx runs on the DOM "contextmenu" event, which WebView2
// fires before it raises ContextMenuRequested to the host) — this module only
// adds three extra command items to the menu WebView2 was already building,
// and emits a "mark-as" window event back to JS when one is clicked.

use tauri::{Emitter, WebviewWindow, Wry};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2Environment9, ICoreWebView2_11,
    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU,
};
use webview2_com::{ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler};
use windows::core::{Interface, HSTRING};

const MARK_AS_ITEMS: [(&str, &str); 3] = [("Me", "me"), ("AI", "ai"), ("Other Website…", "web")];

pub fn install(window: &WebviewWindow<Wry>) {
    let emit_target = window.clone();
    let _ = window.with_webview(move |webview| {
        let core: ICoreWebView2_11 = match unsafe { webview.controller().CoreWebView2() }.and_then(|c| c.cast()) {
            Ok(c) => c,
            Err(_) => return, // older WebView2 runtime — native menu just stays as-is.
        };
        let env: ICoreWebView2Environment9 = match webview.environment().cast() {
            Ok(e) => e,
            Err(_) => return,
        };

        let emit_target2 = emit_target.clone();
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_sender, args| {
            if let Some(args) = args {
                // ponytail: a failed injection just leaves the native menu
                // without "Mark as" for this click — never worth crashing over.
                let _ = unsafe { inject_mark_as(&env, &args, &emit_target2) };
            }
            Ok(())
        }));
        let mut token = 0i64;
        unsafe {
            let _ = core.add_ContextMenuRequested(&handler, &mut token);
        }
    });
}

unsafe fn inject_mark_as(
    env: &ICoreWebView2Environment9,
    args: &ICoreWebView2ContextMenuRequestedEventArgs,
    window: &WebviewWindow<Wry>,
) -> windows::core::Result<()> {
    let target = args.ContextMenuTarget()?;
    let mut has_selection = windows::core::BOOL(0);
    target.HasSelection(&mut has_selection)?;
    if !has_selection.as_bool() {
        return Ok(());
    }

    let submenu = env.CreateContextMenuItem(
        &HSTRING::from("Mark as"),
        None,
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU,
    )?;
    let children = submenu.Children()?;

    for (label, kind) in MARK_AS_ITEMS {
        let item = env.CreateContextMenuItem(
            &HSTRING::from(label),
            None,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
        )?;
        let window = window.clone();
        let kind = kind.to_string();
        let handler = CustomItemSelectedEventHandler::create(Box::new(move |_item, _unused| {
            let _ = window.emit("mark-as", kind.clone());
            Ok(())
        }));
        let mut token = 0i64;
        item.add_CustomItemSelected(&handler, &mut token)?;

        let mut count = 0u32;
        children.Count(&mut count)?;
        children.InsertValueAtIndex(count, &item)?;
    }

    let menu_items = args.MenuItems()?;
    let mut count = 0u32;
    menu_items.Count(&mut count)?;
    menu_items.InsertValueAtIndex(count, &submenu)?;
    Ok(())
}
