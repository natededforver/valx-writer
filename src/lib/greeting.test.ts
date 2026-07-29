import { test } from 'node:test';
import assert from 'node:assert/strict';

// greeting.ts assumes the browser/webview `localStorage` global it runs
// under in the app — plain `node --test` has no DOM, so a minimal in-memory
// stand-in is enough for what these tests touch (getItem/setItem/removeItem).
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

import { greeting, timeGreeting, QUIRKY_DAY, QUIRKY_NIGHT } from './greeting';

const at = (hour: number) => new Date(2026, 0, 1, hour, 0, 0);

// The time/quirky split is random, so these inject the roll instead of leaving
// it to Math.random: `always` forces the time-of-day branch, `never` forces a
// quirky word. Without that, "does the hour still produce Good morning" is a
// test that passes 35% of the time.
const always = () => 0;
const never = () => 0.99;

test('time-of-day greetings', () => {
  assert.equal(greeting(at(8), always), 'Good morning.');
  assert.equal(greeting(at(12), always), 'Good afternoon.');
  assert.equal(greeting(at(18), always), 'Good evening.');
  assert.equal(timeGreeting(at(22)), null, 'late night has no named greeting');
});

test('both kinds stay in rotation within one hour', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(greeting(at(8)));
  assert.ok(seen.has('Good morning.'), 'time-of-day greeting never appeared');
  assert.ok([...seen].some((g) => QUIRKY_DAY.includes(g)), 'quirky greeting never appeared');
});

test('never returns "Good night"', () => {
  for (let h = 0; h < 24; h++) {
    assert.notEqual(greeting(at(h)), 'Good night.');
  }
});

test('daytime hours only ever return a day-pool quirky greeting', () => {
  for (const h of [6, 9, 12, 15, 17, 18]) {
    const g = greeting(at(h));
    assert.ok(QUIRKY_DAY.includes(g) || g === timeGreeting(at(h)), `hour ${h} got "${g}"`);
    assert.ok(!QUIRKY_NIGHT.includes(g), `hour ${h} leaked a night word: "${g}"`);
  }
});

test('night hours (>= 7 PM or < 5 AM) can return night-pool words', () => {
  for (const h of [19, 20, 21, 22, 23, 0, 1, 2, 3, 4]) {
    let sawNight = false;
    for (let i = 0; i < 200 && !sawNight; i++) {
      if (QUIRKY_NIGHT.includes(greeting(at(h), never))) sawNight = true;
    }
    assert.ok(sawNight, `hour ${h} never produced a night word across 200 tries`);
  }
});

test('word lists are large and non-overlapping', () => {
  assert.ok(QUIRKY_DAY.length + QUIRKY_NIGHT.length >= 180, 'expected 180+ combined entries');
  const overlap = QUIRKY_DAY.filter((w) => QUIRKY_NIGHT.includes(w));
  assert.equal(overlap.length, 0, `day/night lists overlap: ${overlap.join(', ')}`);
});
