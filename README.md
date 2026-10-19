# x-copilot

A Chrome extension that writes X posts and replies for me, right inside x.com, in my own voice.

## Why I built it

I'm dyslexic. I like posting, but writing with an AI chat window was slow for me.

The loop went like this: explain what I want in a paragraph, get something a bit off, explain the fix in another paragraph, repeat, then copy and paste it into X.

Every step of that loop is typing. That's the part that's hard for me.

So the one rule of this project is: **I steer by tapping, never by typing instructions.** There is no chat box anywhere in it.

## How it works

```
x.com: tap ✦ on a tweet or on the compose box
   ↓
panel: 3 drafts appear, tap chips to steer, tap Read to hear one
   ↓
"Use this": the text goes straight into X's box
```

- **Three drafts at once**, so I pick instead of write.
- **Chips** like `shorter`, `simpler`, `specific`, `warmer`. They stack, and the drafts redo the moment I tap.
- **Three modes**: Post (turn a rough idea into a post), Reply (it already read the tweet), Clean up (fix spelling and grammar only, keep my words).
- **Read aloud** on every draft. Hearing a draft is faster for me than rereading it.

Two parts:

- `extension/` is the Chrome extension. It adds the ✦ button and the panel to X.
- `server/` is a small Node server on my laptop (`127.0.0.1:8787`). It holds the API key and my voice profile, and calls the OpenAI API (`gpt-5.1`, low reasoning effort so it feels instant).

## It learns from what I do

Every draft I use, edit or post gets logged to a local file. Every 5 new events, the server asks the model to fold them into `voice/learned.md`. That file then shapes the next drafts.

I don't run anything for this. I asked for that on purpose: if learning needs a command, I'd never run it.

My real voice profile (`voice/ledi.md`) is gitignored because it has personal details. `voice/ledi.example.md` is the public template.

## Key decisions

- **Extension, not a website.** A separate tab brings copy and paste back.
- **Extension plus local server.** The API key never sits inside the extension, and the voice profile is a plain file I can edit.
- **OpenAI, not Claude.** I had a Claude version working first and chose to switch. The model call is one small file (`server/model.mjs`), so swapping was easy.
- **Built for dyslexic reading.** The panel uses Atkinson Hyperlegible (a font that makes b/d/p/q and I/l/1 easy to tell apart), cream background instead of white, short lines, no italics, never justified.
- **The panel lives in a Shadow DOM**, so X's own styles can't break it.

## What I learned

- **Writing into someone else's editor is hard.** X's compose box keeps its own copy of the text. Setting the text directly did nothing, and inserting it broke multi-line drafts (Backspace deleted on the wrong line). What worked was faking a paste event, so X handles it like a real paste.
- **Selectors on a site you don't own will break.** All the code that finds tweets and boxes on X sits in one place, so when X changes I know where to look.
- **Testing on real data can pollute it.** My test drafts were getting logged as if I wrote them and teaching the model wrong things. Now I back up the learning files before testing and restore them after.
- **Design for the user's real problem.** Every feature got one question: does this make me type less?

## Run it

1. Get an OpenAI API key at [platform.openai.com](https://platform.openai.com/api-keys). This is separate from a ChatGPT subscription.
2. Set up and start the server:

```bash
cp .env.example .env    # paste your key in here
cp voice/ledi.example.md voice/ledi.md
npm install
npm start
```

3. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick the `extension/` folder.
4. Open x.com. A ✦ shows up on every tweet and on the compose box. `⌘⇧K` opens a blank post draft.

Each draft costs around a cent or two. The server prints the real token count for every draft.

Privacy note: the server only listens on your own machine and only accepts requests from x.com. The 🎙 Speak button uses Chrome's speech recognition, which sends audio to Google.

## Status

It works, and I use it every time I post or reply on X.

Still open: two small UI fixes need a final check in the browser, and drafts sometimes still use quote marks even though my profile bans them.
