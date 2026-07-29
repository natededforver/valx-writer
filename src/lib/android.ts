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
