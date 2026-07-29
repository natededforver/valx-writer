// ---------------------------------------------------------------------------
// Android window insets -> CSS custom properties.
//
// The phone build draws edge-to-edge, so the app root has to keep its own
// chrome clear of the status bar, the navigation bar and the keyboard. CSS
// env(safe-area-inset-*) only gets half of that right on Android: the top
// reports the status bar, the bottom reports 0 even while the gesture pill
// sits over the footer. MainActivity.kt therefore exposes the real insets on
// a __valxInsets bridge and this reads them into --vx-inset-*, which .vx-safe
// (src/index.css) prefers over env().
//
// Inert everywhere else: no bridge, no properties set, and .vx-safe falls back
// to env() — which is what iOS and desktop want anyway.
// ---------------------------------------------------------------------------

interface InsetBridge {
  /** "top,bottom,left,right" in CSS pixels. */
  get(): string;
}

const SIDES = ['top', 'bottom', 'left', 'right'] as const;

/** Publish the current insets. Safe to call before the bridge exists. */
export function syncInsets(): void {
  const bridge: InsetBridge | undefined = (window as any).__valxInsets;
  if (!bridge) return;
  let values: string[];
  try {
    values = String(bridge.get()).split(',');
  } catch {
    return; // bridge went away with the activity — leave the last values up
  }
  if (values.length !== SIDES.length) return;
  const style = document.documentElement.style;
  SIDES.forEach((side, i) => {
    const px = Number(values[i]);
    // A bad reading would collapse the layout onto the status bar; ignoring it
    // leaves the previous (or the env()) value, which is never worse.
    if (Number.isFinite(px) && px >= 0) style.setProperty(`--vx-inset-${side}`, `${px}px`);
  });
}

/** Read once now, then on every change Android announces. */
export function installInsetSync(): void {
  syncInsets();
  window.addEventListener('valx-insets', syncInsets);
}
