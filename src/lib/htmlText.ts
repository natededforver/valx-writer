// Flattening editor HTML down to text, and reading HTML entities back out.
//
// Every "strip the tags" and "decode the entities" site in the app used to
// hand-roll its own regex, and each one had the same two holes:
//
//   1. `/<[^>]+>/g` is not a tag matcher. It stops at the first `>`, so an
//      attribute containing one — `<a title="a > b">` — leaves `b">` behind as
//      text; and because a single pass can *create* a tag out of the leftovers
//      (`<scr<span>ipt>` collapses to `<script>`), one pass is not enough.
//   2. Unescaping entities with a chain of `.replace()` calls double-decodes
//      whenever `&amp;` is handled before the others: `&amp;lt;` becomes
//      `&lt;` becomes `<`, so text that merely *mentions* an entity turns into
//      the character it names.
//
// Both are fixed here once: a tag matcher that understands quoted attribute
// values, applied until the string stops changing, and a single-pass entity
// decoder that can never revisit its own output.

// A tag-shaped construct: comment, doctype/CDATA, processing instruction, or a
// real element tag. The element branch uses the unrolled-loop form
// (`[^<>"']*` then repeats of "quoted string followed by more of the same") so
// no two alternatives can match the same character — that keeps it linear and
// free of the backtracking blowup a naive `(?:"[^"]*"|[^>])*` would invite.
//
// `<` is excluded outside quotes on purpose. Allowing it would let the matcher
// treat `<scr<span>` as one tag, consuming the outer opener and leaving `ipt>`
// as text — the very hole the repeated passes exist to close. Skipping it means
// the inner `<span>` is matched instead, the leftovers spell `<script>`, and the
// next pass removes that. A `<` inside a quoted attribute value is still fine:
// the quoted-string branch takes it.
//
// A trailing unterminated tag at the very end of the string counts too: half a
// tag is markup, and letting it through is how `<div` ends up in a .txt export.
const TAG_LIKE = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[\s\S]*?(?:\?>|$)|<\/?[a-zA-Z][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>|<\/?[a-zA-Z][^<>]*$/g;

// Convergence takes two passes on any realistic note (one to remove the tags,
// one to confirm nothing new appeared). The cap only exists so a pathological
// input can't spin here; anything still tag-shaped after it loses its `<`.
const MAX_STRIP_PASSES = 8;

/**
 * Removes every tag-shaped construct from `html`, repeating until the result is
 * stable so no pass can leave a fresh tag behind. `replacement` is what each
 * tag collapses to — '' to splice the text together, ' ' to keep words apart.
 *
 * Text that only looks like markup is preserved: `5 < 6` and `a <- b` have no
 * tag name after the `<`, so they are not tags and survive untouched.
 */
export function stripTags(html: string, replacement = ''): string {
  let out = html || '';
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const next = out.replace(TAG_LIKE, replacement);
    if (next === out) return out;
    out = next;
  }
  // Still changing after MAX_STRIP_PASSES: deliberately malformed input. Drop
  // the angle brackets outright rather than return something tag-shaped.
  return out.replace(/</g, replacement);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const codePointToText = (cp: number): string | null => {
  if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
};

/**
 * Decodes HTML entities in ONE pass, so a decoded character is never re-read as
 * the start of another entity: `&amp;lt;` decodes to the four characters `&lt;`
 * and stops there, which is what the source text actually said.
 *
 * Unknown named entities are left verbatim rather than guessed at.
 */
export function decodeHtmlEntities(s: string): string {
  return (s || '').replace(
    /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body[0] === '#') {
        const cp =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return codePointToText(cp) ?? whole;
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? whole : named;
    }
  );
}

/** Editor HTML -> a single line of plain text, for previews and search. */
export const htmlToPlainText = (html: string): string =>
  decodeHtmlEntities(stripTags(html, ' ')).replace(/\s+/g, ' ').trim();
