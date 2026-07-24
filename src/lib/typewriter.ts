// Typewriter sounds — synthesized with the Web Audio API so there are no bundled
// audio files (nothing to license, nothing to ship). A key press is a short
// filtered-noise "clack" plus a low thump; Shift+Enter is the carriage-return
// bell + slide. Everything is built per-event and garbage-collected, so holding
// a key never leaks nodes.
//
// Swapping in real samples later: replace playKey/playReturn bodies with an
// AudioBufferSourceNode fed from a decoded sample (drop key.mp3 / return.mp3 in
// public/typewriter and fetch+decodeAudioData once). The toggle wiring below
// stays the same.

export const LS_TYPEWRITER = 'valx-typewriter';
export const TYPEWRITER_EVENT = 'valx-typewriter-changed';

// Ships ON — the sounds are part of the out-of-the-box writing feel, so only an
// explicit 'false' silences them. Mirrored by DEFAULT_ON in prefs.ts, which is
// what puts the checkmark in the menu.
export const typewriterEnabled = (): boolean => localStorage.getItem(LS_TYPEWRITER) !== 'false';

let ctx: AudioContext | null = null;
// Lazily created on the first sound (which only fires from a real keydown, i.e.
// after a user gesture) so autoplay policy never blocks it.
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // Web Audio unavailable — sounds silently disabled
  }
}

// One reusable white-noise buffer (the mechanical component of every clack).
let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.floor(c.sampleRate * 0.06);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = buf);
}

/** A burst of band-passed noise with a fast decay — the "clack". */
function clack(c: AudioContext, when: number, opts: { freq: number; q: number; gain: number; dur: number }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = opts.freq;
  bp.Q.value = opts.q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(opts.gain, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + opts.dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(when);
  src.stop(when + opts.dur + 0.02);
}

/** A decaying sine — the key's low "thump" and the return bell. */
function tone(c: AudioContext, when: number, opts: { freq: number; gain: number; dur: number; type?: OscillatorType }) {
  const osc = c.createOscillator();
  osc.type = opts.type || 'sine';
  osc.frequency.value = opts.freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(opts.gain, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + opts.dur);
  osc.connect(g).connect(c.destination);
  osc.start(when);
  osc.stop(when + opts.dur + 0.02);
}

/** One key press. Small per-press jitter so a run of keys never sounds robotic. */
export function playKey(): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const j = 0.85 + Math.random() * 0.3;
  clack(c, t, { freq: 1750 * j, q: 0.9, gain: 0.28, dur: 0.05 });
  tone(c, t, { freq: 165 * j, gain: 0.12, dur: 0.045 });
}

/** Carriage return (Shift+Enter → new line): the bell "ding" plus the slide. */
export function playReturn(): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  // Bell.
  tone(c, t, { freq: 1180, gain: 0.16, dur: 0.28 });
  tone(c, t, { freq: 1780, gain: 0.06, dur: 0.22 });
  // Carriage slide — a longer, softer noise sweep after the bell.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600, t + 0.04);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.22);
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t + 0.04);
  src.stop(t + 0.26);
}
