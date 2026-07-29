// ---------------------------------------------------------------------------
// The two Android capabilities the web layer can't reach on its own, over the
// __valxAndroid bridge that MainActivity.kt installs.
//
//   printHtml  — Android's WebView implements no window.print(); the call is a
//                silent no-op, which is why Print did nothing on the phone.
//                PrintManager does the work instead.
//   shareText  — the system share sheet, in place of the desktop "Send to"
//                list of hard-coded web targets. The phone already knows which
//                apps can receive a note, and the user's list is better than
//                ours.
//
// Both report whether they ran, so the caller can fall back rather than
// pretend: outside the Android build there is no bridge and they return false.
// ---------------------------------------------------------------------------

interface AndroidBridge {
  print(html: string, jobName: string): void;
  share(text: string, subject: string): void;
  hasStorageAccess(): boolean;
  requestStorageAccess(): void;
  pickFolder(): void;
}

const bridge = (): AndroidBridge | undefined => (window as any).__valxAndroid;

export const hasAndroidBridge = (): boolean => !!bridge();

/**
 * Rewrite every <img> in `root` to a self-contained data: URL.
 *
 * The print WebView is a bare one — it is not wired to Tauri's asset protocol,
 * so an asset://localhost or http://asset.localhost source that renders fine in
 * the app resolves to nothing there and prints as a blank box. Fetching from
 * *this* document works (it is the document those URLs belong to), so the
 * bytes are inlined before the HTML leaves for the bridge.
 *
 * An image that can't be fetched is dropped rather than left broken: a printed
 * page with a missing picture beats one with a placeholder icon in its place.
 */
export async function inlineImages(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      try {
        const blob = await (await fetch(src)).blob();
        img.setAttribute(
          'src',
          await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
        );
      } catch {
        img.remove();
      }
    })
  );
}

/** Send a complete HTML document to the Android print dialog. */
export function printHtml(html: string, jobName: string): boolean {
  const api = bridge();
  if (!api) return false;
  api.print(html, jobName || 'Valx note');
  return true;
}

/** Open the system share sheet with the note's text. */
export function shareText(text: string, subject = ''): boolean {
  const api = bridge();
  if (!api) return false;
  api.share(text, subject);
  return true;
}

// --- workspace folder ------------------------------------------------------

/** True once the user has granted access to storage outside the app's own. */
export function hasStorageAccess(): boolean {
  const api = bridge();
  if (!api) return true; // no bridge, no restriction — desktop and the browser
  try {
    return api.hasStorageAccess();
  } catch {
    return false;
  }
}

/**
 * Send the user to the screen where storage access is granted.
 *
 * Android 11 replaced the runtime dialog for this with a Settings toggle, so
 * there is no "allow" button to await — the app can only open the screen and
 * find out afterwards whether it was flipped. Callers re-check on return
 * rather than waiting on a promise that can never resolve.
 */
export function requestStorageAccess(): boolean {
  const api = bridge();
  if (!api) return false;
  api.requestStorageAccess();
  return true;
}

/**
 * Open the system folder picker; resolves to the chosen path, or null if the
 * user cancelled.
 *
 * The result comes back as a window event rather than a return value: a
 * @JavascriptInterface method returns synchronously and a picker does not.
 * The listener is one-shot and also detaches on a timeout, so an activity that
 * dies without ever reporting (killed in the background, a provider with no
 * result) leaves a resolved promise rather than a caller waiting forever.
 */
export function pickWorkspaceFolder(): Promise<string | null> {
  const api = bridge();
  if (!api) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (path: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('valx-folder-picked', onPicked);
      clearTimeout(timer);
      resolve(path);
    };
    const onPicked = (e: Event) => finish((e as CustomEvent).detail ?? null);
    window.addEventListener('valx-folder-picked', onPicked);
    const timer = setTimeout(() => finish(null), 5 * 60 * 1000);
    api.pickFolder();
  });
}
