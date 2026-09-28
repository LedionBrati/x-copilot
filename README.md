# x-copilot

A drafting copilot that lives **inside x.com**. It writes posts and replies in
your voice, and you steer it by tapping, not by typing instructions.

Built to kill one specific loop: open ChatGPT, describe what you want in prose,
get something slightly wrong, describe the correction in prose, repeat, copy,
paste. Every step of that loop is typing. This replaces all of it with taps.

## How it works

```
 x.com  ──  the ✦ button on any tweet or on the composer
   │
   ▼
 panel  ──  3 drafts appear. tap a chip to steer. tap Read to hear one.
   │
   ▼
 Use this  ──  text goes straight into X's box. no copy, no paste.
```

Two pieces:

- **`extension/`** — a Chrome extension. Injects the button and the panel into X.
- **`server/`** — a small Node server on `127.0.0.1:8787` holding your API key
  and your voice profile. Nothing leaves your machine except the API call itself.

## Three modes

| Mode | What it's for |
|---|---|
| **Post** | You have a rough idea. Type it however it comes out, typos and all. It reads through them and never mentions them. |
| **Reply** | Click ✦ on any tweet. It already read the tweet. Hit draft and get three replies. |
| **Clean up** | You wrote something already. This fixes spelling, grammar and punctuation **only**, and keeps your words and your meaning. Three levels: barely touched, lightly punctuated, tidied. |

## The chips

Instead of typing "make it shorter but keep the second line", you tap `shorter`.
Chips stack, so `shorter` + `simpler` + `spicier` all apply at once, and the
drafts regenerate the moment you tap.

`shorter` `longer` `punchier` `simpler` `specific` `warmer` `drier` `funnier` `softer` `spicier`

## Setup

**1. Get an API key** at [platform.openai.com](https://platform.openai.com/api-keys).

This is pay-as-you-go API billing, and a **ChatGPT Plus or Pro subscription does
not include it** — the API is a separate account balance. Add a few dollars of
credit and it will last a long time at this usage.

```bash
cp .env.example .env
```

Then paste your key into `.env`.

**2. Start the server**

```bash
npm install && npm start
```

**3. Load the extension**

Open `chrome://extensions`, turn on **Developer mode** (top right),
click **Load unpacked**, and choose the `extension/` folder.

**4. Open x.com.** A ✦ appears on every tweet and on the composer toolbar.
`⌘⇧K` anywhere opens a blank post draft. `Esc` closes the panel.

## Making the voice yours

`voice/ledi.md` is the file that matters. It's read fresh on every single
request, so you can edit it and the very next draft uses it. No restart.

It's gitignored, so your profile stays on your machine. Start from the
template: `cp voice/ledi.example.md voice/ledi.md`. Until you do, drafts use
the template. It gets good when you fill it with real examples: posts of yours
that landed, and drafts the copilot got wrong next to what you actually posted
instead.

Every draft you accept is appended to `posted.jsonl` (gitignored) along with the
seed, the chips you used, and the two variants you rejected. That file is the
raw material for sharpening the voice profile later.

## Design notes

The panel is cream paper, not white, and set in **Atkinson Hyperlegible** — a
typeface from the Braille Institute that disambiguates `b/d/p/q` and `I/l/1`,
the letter pairs that cost the most time to a dyslexic reader. Line height is
1.75, letter- and word-spacing are slightly positive, the measure is capped at
56 characters, text is never justified, and there are no italics anywhere. Every
draft has a **Read** button, because hearing a draft is faster than rereading it.

## Cost

Each draft sends roughly 3,000 tokens in (the voice profile and principles,
mostly served from cache after the first call) and gets ~600 back.

That lands in the region of **a cent or two per draft** on `gpt-5.1`, and
noticeably less on `gpt-5-mini`. Check the current rates at
[openai.com/api/pricing](https://openai.com/api/pricing) — the numbers move,
so it's not worth hardcoding them here.

The server prints the real token counts for every draft:

```
reply [punchier specific] → 3 variants in 2.4s (2914 in / 612 out, 2688 cached)
```

Watch that line for a week and you'll know your actual monthly cost precisely.
Switch models with one line in `.env`. Start on `gpt-5.1`, and drop to
`gpt-5-mini` only if the drafts still feel right when you do.

## Privacy

The server binds to `127.0.0.1` and only accepts requests from `x.com`. Your key
lives in `.env`, which is gitignored and never reaches the extension, so no
website can read it. The one
exception worth knowing: the **🎙 Speak** button uses Chrome's built-in speech
recognition, which sends that audio to Google. Type the seed instead if you'd
rather it didn't.
