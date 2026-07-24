import {Window, getCurrentWindow} from '@tauri-apps/api/window';
import {isTauri} from './desktop';

// Startup sequence: `main` is created hidden (tauri.conf.json) while the
// transparent `splash` window shows the logo. Main drives the swap itself —
// it is the only side that knows when the app is actually up, and doing it
// here (rather than having splash listen for a ready event) can't race a
// listener that isn't attached yet.
let done = false;

/** Reveal the main window and dismiss the startup logo. Idempotent. */
export async function dismissSplash(): Promise<void> {
  if (done || !isTauri) return;
  done = true;
  await getCurrentWindow().show().catch(() => {});
  const splash = await Window.getByLabel('splash').catch(() => null);
  await splash?.close().catch(() => {});
}
