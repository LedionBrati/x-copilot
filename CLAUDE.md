# x-copilot

A Chrome extension plus a small local server that drafts X posts and replies
**inside x.com**. Started 2026-09-23.

## The one constraint that drives every decision

Ledi is dyslexic. He likes posting, but kept getting stuck in a loop with AI
chat windows: describe what he wants in prose, get something slightly wrong,
describe the correction in prose, repeat, copy, paste. **Every step of that
loop is typing.** This project exists to delete it.

The rule that follows from that, and the rule to defend in code review:

> **He steers by tapping, never by typing instructions.**

Three drafts appear at once so he picks instead of composing. Refinements are
chips (`shorter`, `simpler`, `specific`) that stack, not a prose instruction
box. There is deliberately **no chat input anywhere in this product.** If a
feature idea reintroduces "tell the AI what to change", it is the wrong feature.

Follow-on rules for anything that renders text here:
- Short lines, plain common words, left-aligned, never justified
- Never comment on or correct his typos. Read through them.
- Every draft gets a read-aloud button. Hearing beats rereading.

## Decisions already made. Do not silently revisit these.

| Decision | Why |
|---|---|
| **OpenAI API, not Claude** | He chose this explicitly on 2026-09-23, after an Anthropic version was already working. Do not switch it back. |
| `gpt-5.1`, `reasoning.effort: "low"` | Low effort is what makes a draft feel instant. It trades thinking depth, not model quality. |
| Chrome extension, not a web app | The tool has to be *on* the page. A separate tab reintroduces copy-paste. |
| Extension + local server, not one piece | Keeps the API key out of the extension bundle, and lets the voice profile be a plain file he edits. |
| Shadow DOM panel | X's stylesheet is aggressive and would otherwise wreck the panel. |
| Atkinson Hyperlegible, cream not white | The typeface disambiguates `b/d/p/q` and `I/l/1`. Cream cuts glare. Both are legibility decisions, not taste ones. |

## Layout

```
server/
  index.mjs    HTTP server on 127.0.0.1:8787. Host pinned, CORS allows x.com
               and chrome-extension:// (the service worker is what calls).
  model.mjs    prompt assembly + the OpenAI call. The brain.
  learn.mjs    automatic voice learning. Every 5 new events in posted.jsonl
               it folds them into voice/learned.md. Nothing for him to run.
voice/
  ledi.md      THE important file, and his. Gitignored: it holds personal
               details, and the repo is public. Read fresh on every request, so
               edits take effect on the next draft with no restart. Nothing
               automated ever writes to it.
  ledi.example.md  the public, blank template. Used when ledi.md is missing.
  learned.md   gitignored. Written by learn.mjs from his edits; outranks
               ledi.md where they disagree. /health shows how much it has seen.
  principles.md  his X writing principles
  corpus.jsonl  gitignored. His real X posts and replies, scraped 2026-09-24,
               the evidence ledi.md was derived from.
extension/
  manifest.json  MV3
  background.js  service worker. All network calls go through here, so
                 x.com's CSP can't block them.
  content.js     injects the ✦ button, reads tweets, writes into X's composer
  panel.css      the panel. Design rationale is in the file header.
  fonts/         Atkinson Hyperlegible woff2, bundled so there's no CDN call
posted.jsonl   gitignored. Append-only event log: "used" (draft vs what he
               kept, plus rejected alternatives), "edit" (a draft he rewrote
               before Redo), "posted" (what he actually sent on X, read at
               the click on X's own Post/Reply button).
```

## Commands

```bash
npm start          # server on :8787
npm run dev        # same, restarts on file change
curl -s localhost:8787/health
```

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
After editing extension files, hit reload on the card there, then reload x.com.

## State as of the handoff

Working and verified:
- Server boots, `/health` responds, errors are human-readable
- Zod schema converts to a valid OpenAI strict JSON schema
- Panel renders correctly; contrast measured and above the floor

Real API calls verified 2026-09-24 in every mode (post, reply, quote, fix).

## Next steps, roughly in order

1. **Make one real draft** and see what comes back.
2. ~~Calibrate `voice/ledi.md`.~~ Done 2026-09-24, derived from 61 of his
   real X posts and replies (@LedionBrati, 18 posts + 43 replies) using
   ghostwriter-os's fingerprint tool, with tone borrowed from the
   linkedin-voice skill where the X posts agree. Raw corpus is in
   `voice/corpus.jsonl` (gitignored). The post rules are provisional (18
   posts is thin): re-scrape and recalibrate once he has ~50 more.
3. ~~Feed `posted.jsonl` back in.~~ Done and automatic, see `learn.mjs`. He
   asked explicitly that learning never needs a command or manual step:
   keep it that way.

## Gotchas that already bit, or will

- **Zod must be v4.** `betaZodOutputFormat`/`zodTextFormat` call
  `z.toJSONSchema`, which does not exist in Zod 3. Failure is a confusing
  `z.toJSONSchema is not a function` at request time, not install time.
- **OpenAI's strict schema subset ignores `minItems`/`maxItems`.** "Exactly 3
  variants" is enforced by the prompt and a `.slice(0, 3)`, not by the schema.
- **The OpenAI client is built lazily on purpose.** Its constructor throws when
  no key is set, which would stop the server booting and hide the friendly
  setup message. Keep the `openai()` accessor in `model.mjs`.
- **Write into X's composer with a synthetic paste, not `insertText`.** X's
  box is Draft.js: it keeps its own copy of the text, one block per line.
  Setting `textContent` does nothing. `insertText` works for one line, but a
  multi-line draft lands in its copy as ONE block while the screen shows
  several, so the caret he sees and the caret X uses disagree and Backspace
  deletes on a line he didn't click. A `ClipboardEvent("paste")` carrying a
  `DataTransfer` is split into real blocks, and X leaves the caret at the
  end. `insertText` stays only as the fallback if X stops taking the paste.
  Check: count `[data-block="true"]` in the box, it must equal the lines.
- **X's editor keeps its own record of where the caret is.** Building a
  range by hand and moving the caret yourself leaves that record pointing at
  the start. Select with `execCommand("selectAll")`, then WAIT for the
  `selectionchange` event before pasting: paste straight away and X inserts
  at the old caret instead of replacing. Check focus is really in the box
  first, or selectAll selects the whole page.
- **Several compose boxes can be on the page at once**, and only some of
  them are visible. The toolbar ✦ remembers the box it was clicked from
  (`state.target`, found by `boxNear`), and "Use this" writes back into
  that one. The tweet-row ✦ and ⌘⇧K clear it, so they fall back to the
  box inside the open popup (`[role="dialog"]`), then the first box. With a
  popup open, the home feed's box is still behind it with the SAME testid
  and comes first in the DOM, so a bare `querySelector` picks the hidden one.
- **X's `data-testid` selectors are the fragile part.** If the ✦ stops
  appearing after an X redesign, look at `TWEET` and `decorate()` in
  `content.js` first.
- **Never dispatch an extra InputEvent after `execCommand`.** It made X apply
  the text twice and tore focus out of the box, so a used draft could not be
  edited or deleted.
- **X's compose boxes are anonymous divs**, no testid or role up the tree, so
  "is this a reply or a quote" cannot be read from the open box. It is
  captured at the click on X's reply/repost button instead. Both boxes open
  at /compose/post, so a URL change alone must not clear that intent.
- **Reloading the extension orphans already-open x.com tabs.** Their ✦ stays
  on the page but every chrome.* call throws; the button now says "reload
  page". Test in a freshly loaded tab.
- **Browser automation can't type reliably into X's composer.** Its key events
  arrive scrambled and backspace is ignored, even with no extension code
  involved. Editing feel has to be checked by hand.
- **Never click X's Post, Reply or Repost buttons while testing.** He does not
  want anything posted without his say. Close test boxes with X's × and pick
  **Discard**. Never fire a synthetic ⌘↵ in a compose box: X may post it.
- **Testing pollutes his voice.** Every test "used"/"edit" lands in
  posted.jsonl, and 5 new events trigger a learning run that writes
  learned.md. Before testing, copy posted.jsonl, voice/learned.md and
  voice/.learned-state.json aside; restore all three after.
- **A test tab that isn't the focused window is throttled.** Timers slow to
  ~1s, so the ✦ appears late, X's reply popup builds late, and the clipboard
  refuses to write. Judge speed and Copy only in a tab he is looking at.
- **What a post was for is matched on the box, then the tweet.** `remember()`
  stores the draft plus the box it went into (Use this) or the target box
  (Copy). `intentFor()` pairs the post with that draft only if it leaves the
  same box, or answers the same tweet. A 30 minute window alone once paired
  a post with a draft for a different tweet.
- **The tweet-row ✦ opens X's reply popup itself** on Use this (clicking the
  tweet's reply icon, which only opens a box), then writes into it. Before,
  the reply landed in the home "What's happening" box as a plain post.
- **The panel must stay inside the shadow root.** Anything appended to the page
  directly will get styled by X.
