// ---------------------------------------------------------------------------
// App preferences. These used to live as exports on SettingsModal, which meant
// every consumer (the editor, the menu bar, App's boot code) imported a React
// component just to read a localStorage key. The Settings panel is gone now —
// its toggles moved into the menu bar and only the field-shaped preferences
// kept a dialog — so the keys, defaults and change events live here instead,
// with no UI attached.
//
// Every toggle follows the same shape: a localStorage key, a default, and a
// window CustomEvent so an already-open editor reacts without a reload.
// ---------------------------------------------------------------------------

export const LS_SPELL_LANG = 'valx-spellcheck-lang';
export const LS_SPELLCHECK_ON = 'valx-spellcheck-on';
export const LS_AUTOCAP = 'valx-autocap';
export const LS_LINE_COUNTER = 'valx-line-counter';
export const LS_WORDCOUNT = 'valx-wordcount-widget';
export const LS_WORDCOUNT_GOAL = 'valx-wordcount-goal';
export const LS_HISTORY_INTERVAL = 'valx-history-interval';
export const LS_TRANSPARENCY = 'valx-transparency';
// Typewriter sounds own their key next to the synth that reads it.
import { LS_TYPEWRITER } from './typewriter';
export { LS_TYPEWRITER, TYPEWRITER_EVENT } from './typewriter';

export const LINE_COUNTER_EVENT = 'valx-line-counter-changed';
export const WORDCOUNT_EVENT = 'valx-wordcount-changed';
export const HISTORY_INTERVAL_EVENT = 'valx-history-interval-changed';
export const AUTOCAP_EVENT = 'valx-autocap-changed';
export const SPELLCHECK_EVENT = 'valx-spellcheck-changed';

export const DEFAULT_HISTORY_INTERVAL = 10;

// Defaults that ship ON: auto-capitalize, the word-count pill, the line
// counter and the typewriter sounds are all part of the out-of-the-box writing
// setup, so their absence from localStorage means "on" and only an explicit
// 'false' turns them off.
// Transparency ships OFF — the app opens as a solid, opaque window.
const DEFAULT_ON = [LS_AUTOCAP, LS_WORDCOUNT, LS_LINE_COUNTER, LS_SPELLCHECK_ON, LS_TYPEWRITER];

/** Read a boolean preference, honouring its ship-default. */
export function prefOn(key: string): boolean {
  const v = localStorage.getItem(key);
  if (v === null) return DEFAULT_ON.includes(key);
  return v === 'true';
}

/** Write a boolean preference and announce it on `event` (when given). */
export function setPref(key: string, value: boolean, event?: string): void {
  localStorage.setItem(key, String(value));
  if (event) window.dispatchEvent(new CustomEvent(event, { detail: value }));
}

/** Word-count goal in words; 0 means "no goal". */
export function wordGoal(): number {
  return parseInt(localStorage.getItem(LS_WORDCOUNT_GOAL) || '0', 10) || 0;
}

export function setWordGoal(goal: number): void {
  const v = Math.max(0, Math.round(goal) || 0);
  localStorage.setItem(LS_WORDCOUNT_GOAL, String(v));
  window.dispatchEvent(
    new CustomEvent(WORDCOUNT_EVENT, { detail: { enabled: prefOn(LS_WORDCOUNT), goal: v } })
  );
}

/** Emit the word-count event after an enabled/disabled flip. */
export function emitWordCount(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent(WORDCOUNT_EVENT, { detail: { enabled, goal: wordGoal() } }));
}

/** Minutes between automatic version snapshots. */
export function historyInterval(): number {
  const v = parseInt(localStorage.getItem(LS_HISTORY_INTERVAL) || '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_HISTORY_INTERVAL;
}

export function setHistoryInterval(mins: number): number {
  const clamped = Math.min(120, Math.max(1, Math.round(mins) || DEFAULT_HISTORY_INTERVAL));
  localStorage.setItem(LS_HISTORY_INTERVAL, String(clamped));
  window.dispatchEvent(new CustomEvent(HISTORY_INTERVAL_EVENT, { detail: clamped }));
  return clamped;
}

// ---------------------------------------------------------------------------
// Writing-surface spacing. Stored in px, 0 meaning "leave the typeface alone".
// These reach the editor as CSS custom properties rather than React state: the
// sliders then repaint the text directly, with no re-render of the note while
// the handle is being dragged.
// ---------------------------------------------------------------------------
export const LS_WORD_SPACING = 'valx-word-spacing';
export const LS_LETTER_SPACING = 'valx-letter-spacing';
export const SPACING_EVENT = 'valx-spacing-changed';

export const WORD_SPACING_RANGE = { min: 0, max: 16, step: 0.5 };
export const LETTER_SPACING_RANGE = { min: -1, max: 6, step: 0.1 };

const readPx = (key: string): number => {
  const v = parseFloat(localStorage.getItem(key) || '');
  return Number.isFinite(v) ? v : 0;
};

export const wordSpacing = (): number => readPx(LS_WORD_SPACING);
export const letterSpacing = (): number => readPx(LS_LETTER_SPACING);

/** Push the saved spacing onto the document as CSS variables. Called on boot so
 *  the saved choice is in place before the first paint, and after every move. */
export function applySpacing(): void {
  const s = document.documentElement.style;
  s.setProperty('--vx-word-spacing', `${wordSpacing()}px`);
  s.setProperty('--vx-letter-spacing', `${letterSpacing()}px`);
}

/** Write one of the two spacing prefs, clamped to its slider's range. Returns
 *  the stored value so the caller can hold the clamped number, not the raw. */
export function setSpacing(key: string, px: number): number {
  const range = key === LS_WORD_SPACING ? WORD_SPACING_RANGE : LETTER_SPACING_RANGE;
  const v = Math.min(range.max, Math.max(range.min, Number(px) || 0));
  localStorage.setItem(key, String(v));
  applySpacing();
  window.dispatchEvent(new CustomEvent(SPACING_EVENT, { detail: { key, value: v } }));
  return v;
}

/** Toggles the .vx-opaque class (index.css) that flattens the sidebar and
 *  window titlebar's glass effect to a solid background. Called on boot so the
 *  saved choice — opaque by default — is applied before the first paint. */
export function applyTransparency(enabled: boolean): void {
  document.documentElement.classList.toggle('vx-opaque', !enabled);
}
