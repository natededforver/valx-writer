# Windows handoff — what changed on macOS, and what Windows must mirror

Written for whoever picks this up on the Windows side. Everything below is
already on `main`, so there is **nothing to port** — `git pull` has it. What this
document exists for is the one change that will look wrong to you, and which you
must not "fix" back.

---

## 0. Read this before touching the slop marks

**Do not reintroduce `background-clip: text` on `mark.vx-slop`.**

It works on Windows. That is exactly the trap. It has been put back three times,
each time by someone who tested on WebView2, saw it render beautifully, and
shipped it — and each time it erased the user's words on macOS.

### Why it fails, precisely

Clipping a background to the glyphs makes the letterforms the only thing
painting the words. `color` is `transparent`; the text you see *is* the
background, showing through the shape of the letters. So when the engine
declines that paint, you do not lose the texture. **You lose the writing.** The
words are still in the DOM, still in the `.md`, still counted in the word count —
and completely invisible on screen.

On WKWebView in the packaged app the marks paint once and then vanish on the
very next repaint. Not on load — *after*. The trigger is the app window itself:
`tauri.conf.json` sets `"transparent": true` with `macOSPrivateApi: true`, which
puts WKWebView on a non-opaque compositing path. CSS does not get to opt out of
that.

### Why the previous three fixes did not hold

Each one blamed whatever knob was nearest and none of them was the cause:

| Attempt | Blamed | Verdict |
| --- | --- | --- |
| `d2c7215` | `background-attachment: fixed` | Real WebView2 bug, unrelated to this |
| `ffb2c1d` | the 480px tile ("too large to paint") | Wrong — 80px is just as invisible |
| earlier | the PNG failing to load | A real hazard, but not this failure |

Verified in Safari over `http` (same WebKit): **every** variant of the clipped
rule paints and keeps painting through forced restyles — tile size, padding,
`box-decoration-break`, `-webkit-text-fill-color` and a filtered ancestor all
made no difference. The mechanism is what is fragile, not any of its settings.

> Testing this over `file://` will mislead you. Safari blocks `file://`
> subresources, so the PNG never loads and *everything* looks broken for the
> wrong reason. Serve over http.

### What it does now

`src/index.css` paints marked words with plain `color:` — ordinary text
rendering, opaque, no background, no image, no clip. Each word steps along the
old sd-texture ramp (crimson → purple → indigo) via the existing 8-step
`nth-of-type` cycle, with a lifted variant under `.dark`.

There is no paint path left that can drop these words. A wrong colour is the
worst failure available.

**The trade-off, stated honestly:** the mottling *within* a single word is gone;
what survives is the colour progression *across* a run. That is most of what
actually read at reading size anyway — `2fd2fd4` had to shrink the tile from
480px to 80px precisely because a ~50px word against a large tile came out one
flat colour. One colour per word, walking the ramp, is what the texture was
already delivering.

`sd-texture.png` is now **unreferenced**. It still exists in the repo; the build
drops it, which is the DMG going 20 MB → 18 MB. Leave the file alone unless you
have decided the texture is never coming back.

If you want real grain back, there is one way that keeps the safety property:
store each word in a `data-w` attribute at mark creation and paint a textured
`::after` copy *over* the solid text. If the clip fails you lose the texture,
never the words. It needs a JS change plus a backfill for marks loaded from
existing `.md` files, and it adds bytes per marked word.

---

## 1. "Mark as → Other Websites" was dead, and so were named authors

Fixed separately in `f0fe171`, noted here because the cause is worth knowing.

The macOS port replaced the Windows native context menu with a JS-drawn one. The
native menu's handler (`native_mark_as.rs`) was where the menu *kinds* were
decoded, and that decoding did not come across. Every item was passed through
raw, so:

- `'web'` marked the words with no source and never opened the source dialog
- `'author:<id>'` was written to the DOM as `data-slop="author:a1b2c3"` — a type
  nothing recognises, so named co-authors silently vanished from the byline

`markSelectionAs` in `src/components/RichTextEditor.tsx` now decodes the kind
itself, so the menu and the dialog share one entry point: `'web'` with no site
opens the dialog, which calls back with one. **Windows gets this for free and
should keep the JS menu** — the native menu no longer has anything the drawn one
lacks, and one menu is one thing to keep working.

---

## 2. New: Forbidden Words

`Words > Forbidden Words…` — a global list of words the writer is trying to stop
using. Matches go grey in the editor.

- `src/lib/forbidden.ts` — storage, matching, 11 unit tests in `forbidden.test.ts`
- `src/components/ForbiddenModal.tsx` — the dialog, event-opened like `DictionaryModal`
- `paintForbidden` in `RichTextEditor.tsx` — the painting

Matching notes, all covered by tests: whole words only (`damn` does not match
`Damning`), case-insensitive, symbols never participate (`damn,` matches, the
comma stays black), multi-word entries match consecutive words, longest entry
wins, symbols-only entries are rejected at the dialog with a reason.

Painted with the **CSS Custom Highlight API**, the same mechanism as `#tag` and
checked-task styling. This is load-bearing: no DOM mutation, so the greying
never reaches the note's HTML, never lands in the `.md`, and disappears the
moment a word leaves the list. Do not reimplement it by wrapping matches in
elements — that fights the caret and pollutes saved content.

---

## 3. New: "Human authors" off greys the unmarked text

The other three Creators toggles hide a provenance type. This one answers the
opposite question — "what here isn't mine?" — by greying everything *not*
marked, while marked words keep their colour. One rule, `.vx-hide-human
.rich-editor`, deliberately at two classes so every mark rule outranks it.

---

## 4. Smaller things

- **Every trash icon is the macOS bin emoji** (`src/components/BinIcon.tsx`).
  Six call sites across five files now share one component. Check it renders
  sensibly in Segoe UI Emoji on Windows — this is the one change in here with a
  real chance of looking different on your platform, and if it does, the fix
  belongs in `BinIcon` alone.
- **Dictionary and Forbidden Words lists are capped short and scroll.**
  Scrollbars are hidden app-wide, so `.vx-list-scroll` opts back in next to
  `.vx-editor-scroll` in `index.css`.
- The paragraph glow, the mark padding and the mark border-radii are gone. All
  three propped up a background that no longer exists.

---

## 5. Build

Unchanged: `scripts/release.ps1` on Windows, `scripts/release.sh` on macOS. No
platform branching was added by any of the above.
