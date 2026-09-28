/* x-copilot — lives inside x.com.
   Everything renders in a shadow root so X's stylesheet can't reach it
   and this file's styles can't leak back out into X. */

(() => {
  "use strict";
  if (window.__xCopilotLoaded) return;
  window.__xCopilotLoaded = true;

  const MODES = {
    post:  { label: "Post",       hint: "Type the rough idea. Typos don't matter, it reads through them." },
    reply: { label: "Reply",      hint: "Say your take however it comes out. It builds on your words." },
    fix:   { label: "Clean up",   hint: "Paste what you wrote. It fixes spelling and grammar only, and keeps your words." },
    quote: { label: "Quote",      hint: "Say your take on this post. It builds on your words." },
  };

  // Quote only exists when he came from X's Quote button; as a standing tab
  // it would just be a fourth thing to read with nothing to quote.
  const tabsFor = (mode) => Object.keys(MODES).filter((k) => k !== "quote" || mode === "quote");
  const hasSubject = (mode) => mode === "reply" || mode === "quote";

  const CHIPS = ["shorter", "longer", "punchier", "simpler", "specific", "warmer", "funnier", "spicier"];

  const state = {
    mode: "post",
    chips: new Set(),
    context: null,
    variants: [],
    busy: false,
    speakingIndex: null,
    // { mode: "reply" | "quote", tweet } for the compose box X is about to
    // open. See watchForComposeIntent.
    pending: null,
    // The compose box the ✦ was clicked from, so "Use this" writes back into
    // it. null means "the first box on the page".
    target: null,
  };

  let host, root, ui;

  /* ------------------------------------------------------------ server -- */

  // Reloading the extension orphans the copy of this script already running in
  // open x.com tabs: its buttons stay on the page, but every chrome.* call
  // throws "Extension context invalidated". That happens every time the
  // extension is edited, so it gets a plain instruction, not a stack trace.
  const STALE = "x-copilot was updated. Reload this page to use it.";
  const orphaned = () => !chrome.runtime?.id;

  function send(type, payload) {
    return new Promise((resolve) => {
      if (orphaned()) return resolve({ ok: false, error: STALE });
      chrome.runtime.sendMessage({ type, payload }, (res) =>
        resolve(res || { ok: false, error: "The extension background worker didn't answer. Try reloading the page." })
      );
    });
  }

  /* -------------------------------------------------------- X's DOM ----- */

  const TWEET = 'article[data-testid="tweet"]';

  function readTweet(article) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const handle = nameEl?.innerText?.match(/@[\w]+/)?.[0] || "";
    return {
      text: textEl?.innerText?.trim() || "",
      author: handle.replace(/^@/, ""),
      thread: [],
    };
  }

  /** X's reply box is anonymous divs the whole way up: no testid, no role, no
      aria-modal, and the feed sits inside the same ancestors, so there is
      nothing in the opened composer that reliably says "this is a reply".
      The intent is caught at the click on X's own reply or repost button
      instead. Consumed once, by the composer button.

      Both boxes open at /compose/post, so a URL change on its own means
      nothing: the intent is only dropped when he navigates somewhere that
      is not a compose box, or picks a plain repost, which opens none. */
  function watchForComposeIntent() {
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        const postBtn = t?.closest?.('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
        if (postBtn && postBtn.getAttribute("aria-disabled") !== "true") recordPost(postBtn);
        if (t?.closest?.('[data-testid="retweetConfirm"]')) {
          state.pending = null;
          return;
        }
        const reply = t?.closest?.('[data-testid="reply"]')?.closest(TWEET);
        if (reply) state.pending = { mode: "reply", tweet: readTweet(reply) };
        // The repost button only opens X's menu; Quote is chosen in there.
        const quote = t?.closest?.('[data-testid="retweet"]')?.closest(TWEET);
        if (quote) state.pending = { mode: "quote", tweet: readTweet(quote) };
      },
      true
    );
    let path = location.pathname;
    setInterval(() => {
      if (location.pathname === path) return;
      path = location.pathname;
      if (!path.startsWith("/compose/")) state.pending = null;
    }, 500);
  }

  /** What he actually posts is the best evidence of his voice there is, with or
      without a draft behind it. Read at the click on X's own Post / Reply
      button, in the capture phase, before X clears the box. Only reads: never
      blocks, delays, or changes the post. Stays in posted.jsonl on this Mac. */
  function recordPost(btn) {
    let n = btn;
    let text = "";
    for (let i = 0; n && i < 25 && !text; i++, n = n.parentElement) {
      const boxes = n.querySelectorAll?.('[data-testid^="tweetTextarea_"][contenteditable="true"]');
      if (boxes?.length) text = [...boxes].map((b) => b.innerText.trim()).filter(Boolean).join("\n\n");
    }
    if (!text) return;
    // A draft used more than half an hour ago is not what this post came from.
    const use = state.lastUse && Date.now() - state.lastUse.at < 30 * 60 * 1000 ? state.lastUse : null;
    state.lastUse = null;
    send("accepted", {
      event: "posted",
      text,
      mode: use?.mode || state.pending?.mode || "post",
      context: use?.context || state.pending?.tweet || null,
      drafted: use?.drafted || null,
      used: use?.used || null,
    });
  }

  /** What a composer-bar draft is for: a reply, a quote, or a fresh post. */
  function composerIntent() {
    if (state.pending) return state.pending;
    // Opened straight onto a tweet's own page: the reply box is already there
    // and he may never touch X's reply button, so the page's subject is it.
    if (/\/status\/\d+/.test(location.pathname)) {
      const first = document.querySelector(TWEET);
      if (first) return { mode: "reply", tweet: readTweet(first) };
    }
    return { mode: "post", tweet: null };
  }

  /** X's composer is a managed contenteditable (Draft.js). It keeps its own
      copy of the text, split into one block per line, and only trusts text
      that arrives through events it handles itself. */
  async function writeIntoComposer(text) {
    const box =
      (state.target?.isConnected && state.target) ||
      // With a reply or post popup open, the home feed's box is still on the
      // page behind it under the same testid, and it comes first.
      document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]') ||
      document.querySelector('[data-testid="tweetTextarea_0"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"]');
    if (!box) return false;
    box.focus();
    // If focus didn't land in the box, "selectAll" would select the whole
    // page instead. Bail out so the draft goes to the clipboard.
    if (!box.contains(document.activeElement)) return false;
    // "selectAll" selects the text the way a user would, so the draft
    // replaces whatever is there. The editor only learns about the new
    // selection from the selectionchange event, which fires a moment later.
    // Pasting before then inserted at the old caret instead of replacing.
    const selected = new Promise((r) => {
      document.addEventListener("selectionchange", r, { once: true });
      setTimeout(r, 150);
    });
    document.execCommand("selectAll");
    await selected;
    await new Promise((r) => setTimeout(r, 0));
    // Hand the draft over as a paste. insertText put a multi-line draft into
    // the editor's copy as ONE line while the screen showed several, so the
    // caret on screen and the editor's caret disagreed, and Backspace deleted
    // on a line he hadn't clicked. A paste is split into real lines by X.
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    box.dispatchEvent(paste);
    if (paste.defaultPrevented) return true;
    // X didn't take the paste (editor changed?). Plain insert still beats
    // nothing for a one-line draft. Never add a second InputEvent on top:
    // that made the editor apply the text twice.
    return document.execCommand("insertText", false, text);
  }

  /* ------------------------------------------------------- the button --- */

  const BTN = "x-copilot-btn";

  function makeButton(onClick, title) {
    const b = document.createElement("button");
    b.className = BTN;
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.textContent = "✦";
    Object.assign(b.style, {
      all: "unset",
      cursor: "pointer",
      fontSize: "15px",
      lineHeight: "1",
      padding: "6px 8px",
      borderRadius: "999px",
      color: "#9C4708",
      transition: "background .15s",
    });
    b.addEventListener("mouseenter", () => (b.style.background = "rgba(156,71,8,.12)"));
    b.addEventListener("mouseleave", () => (b.style.background = "transparent"));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (orphaned()) {
        b.textContent = "✦ reload page";
        // The usual #9C4708 is 3.3:1 on X's black: fine for a glyph, too
        // faint for words. This one clears 4.5:1 on both black and white.
        b.style.color = "#BD5912";
        b.style.fontWeight = "700";
        b.title = STALE;
        b.setAttribute("aria-label", STALE);
        return;
      }
      onClick();
    });
    return b;
  }

  function decorate() {
    // one button per tweet, in the row with reply/repost/like
    for (const article of document.querySelectorAll(TWEET)) {
      const bar = article.querySelector('[role="group"]');
      if (!bar || bar.querySelector("." + BTN)) continue;
      bar.appendChild(
        makeButton(() => {
          state.context = readTweet(article);
          state.target = null;
          open("reply");
        }, "Draft a reply with x-copilot")
      );
    }

    // One button on every compose box's toolbar. A reply box opened over the
    // home feed means two are on the page at once, and only decorating the
    // first could leave the reply box without one.
    for (const toolbar of document.querySelectorAll('[data-testid="toolBar"]')) {
      if (toolbar.querySelector("." + BTN)) continue;
      toolbar.appendChild(
        makeButton(() => {
          const { mode, tweet } = composerIntent();
          state.pending = null;
          state.context = tweet;
          // "Use this" must write back into this box, not whichever is first.
          state.target = boxNear(toolbar);
          open(mode);
        }, "Draft with x-copilot")
      );
    }
  }

  /** The compose box belonging to a toolbar: the nearest one up the tree. */
  function boxNear(node) {
    for (let n = node, i = 0; n && i < 25; i++, n = n.parentElement) {
      const box = n.querySelector?.('[data-testid^="tweetTextarea_"][contenteditable="true"]');
      if (box) return box;
    }
    return null;
  }

  /* -------------------------------------------------------- the panel --- */

  async function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "x-copilot-host";
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);

    // Load the stylesheet as a file, then point the @font-face rules at the
    // bundled woff2 via extension URLs.
    const css = await fetch(chrome.runtime.getURL("panel.css"))
      .then((r) => r.text())
      .then((t) =>
        t
          .replace("__FONT400__", chrome.runtime.getURL("fonts/ahl-400.woff2"))
          .replace("__FONT700__", chrome.runtime.getURL("fonts/ahl-700.woff2"))
      );
    const style = document.createElement("style");
    style.textContent = css;
    root.appendChild(style);
  }

  function el(tag, props = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
    for (const kid of [].concat(kids)) if (kid) n.appendChild(kid);
    return n;
  }

  async function open(mode) {
    await mount();
    state.mode = mode;
    state.variants = [];
    state.chips.clear();
    render();
    // Deliberately does not draft on open. His own rough take is the best
    // steer the model gets, and drafting first throws three finished replies
    // at him before he has decided what he thinks.
    setTimeout(() => root.querySelector(".seed")?.focus(), 350);
  }

  function close() {
    const p = root?.querySelector(".panel");
    if (!p) return;
    speechSynthesis.cancel();
    p.classList.add("closing");
    setTimeout(() => p.remove(), 200);
  }

  function render() {
    root.querySelector(".panel")?.remove();

    const seed = el("textarea", {
      class: "seed",
      placeholder:
        state.mode === "fix"
          ? "Paste what you wrote."
          : hasSubject(state.mode)
          ? "your take, however it comes out"
          : "what you want to say, however it comes out",
      rows: "3",
    });
    seed.value = ui?.seedValue || "";
    seed.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
    });

    // Once drafts exist they are the thing being read, so the input above them
    // gives its room back. Everything returns when the drafts are cleared.
    const panel = el("div", {
      class: state.variants.length ? "panel has-results" : "panel",
      role: "dialog",
      "aria-label": "x-copilot",
    }, [
      el("div", { class: "head" }, [
        el("div", { class: "mark" }, [document.createTextNode("x-copilot")]),
        el("span", { class: "status", text: "" }),
        el("button", { class: "close", "aria-label": "Close", text: "×", onclick: close }),
      ]),
      el(
        "div",
        { class: "modes", role: "tablist" },
        tabsFor(state.mode).map((key) =>
          el("button", {
            class: "mode",
            role: "tab",
            "aria-selected": String(state.mode === key),
            text: MODES[key].label,
            onclick: () => {
              state.mode = key;
              state.variants = [];
              render();
            },
          })
        )
      ),
      el("div", { class: "mode-hint", text: MODES[state.mode].hint }),
      hasSubject(state.mode) && state.context
        ? el("div", { class: "context" }, [
            el("div", {
              class: "who",
              text: (state.mode === "quote" ? "quoting " : "replying to ") +
                (state.context.author ? "@" + state.context.author : "this post"),
            }),
            el("div", { class: "what", text: state.context.text }),
          ])
        : null,
      el("div", { class: "seed-wrap" }, [
        seed,
        el("div", { class: "seed-row" }, [
          el("button", { class: "go", text: state.busy ? "drafting…" : "Draft 3", onclick: generate }),
          el("button", { class: "mic", text: "🎙 Speak", "data-on": "false", onclick: dictate }),
          el("div", { class: "hint", text: "⌘↵" }),
        ]),
      ]),
      el("div", { class: "chips" }, [
        el("div", { class: "chips-label", text: "Adjust" }),
        ...CHIPS.map((c) =>
          el("button", {
            class: "chip",
            "aria-pressed": String(state.chips.has(c)),
            text: c,
            onclick: () => {
              state.chips.has(c) ? state.chips.delete(c) : state.chips.add(c);
              render();
              // Only re-steers drafts that exist; before that a chip is just
              // queued, so tapping one never drafts ahead of his own take.
              if (state.variants.length) generate();
            },
          })
        ),
      ]),
      el("div", { class: "results" }),
    ]);

    root.appendChild(panel);
    seed.addEventListener("input", () => (ui = { ...ui, seedValue: seed.value }));
    paint();
  }

  /** Grow a draft box to fit its text, so an edited draft never scrolls inside itself. */
  function fit(box) {
    box.style.height = "auto";
    box.style.height = box.scrollHeight + "px";
  }

  function paint() {
    const out = root.querySelector(".results");
    if (!out) return;
    // Repaints happen under him, e.g. when read-aloud finishes. If he was
    // mid-edit in a draft, put him back exactly where he was.
    const active = root.activeElement;
    const editing = active?.classList?.contains("text")
      ? { i: Number(active.dataset.i), start: active.selectionStart, end: active.selectionEnd }
      : null;
    out.textContent = "";

    if (state.busy) {
      out.appendChild(
        el("div", { class: "thinking" }, [el("div", { class: "bar" }), el("div", { class: "word", text: "writing three versions" })])
      );
      return;
    }
    if (state.error) {
      out.appendChild(el("div", { class: "note bad", text: state.error }));
      return;
    }
    if (!state.variants.length) {
      out.appendChild(
        el("div", {
          class: "note",
          text:
            state.mode === "fix"
              ? "Paste your text above and hit Draft 3. You'll get three versions: barely touched, lightly punctuated, and tidied."
              : "Hit Draft 3. Then change the words in any draft and tap Redo, or tap a chip to steer all three.",
        })
      );
      return;
    }

    state.variants.forEach((v, i) => {
      // The draft is its own edit box: changing words is how he steers one
      // draft, with no instruction to type. Redo then rewrites just this card.
      const box = el("textarea", {
        class: "text",
        rows: "1",
        spellcheck: "false",
        "data-i": String(i),
        "aria-label": `Draft ${i + 1}. You can change the words.`,
      });
      box.value = v.text;
      box.disabled = !!v.busy;

      const count = el("div", {
        class: "count",
        "data-over": String(v.text.length > 280),
        text: `${v.text.length}/280`,
      });
      const angle = el("div", { class: "angle", text: label(v, i) });

      box.addEventListener("input", () => {
        v.text = box.value;
        fit(box);
        count.textContent = `${v.text.length}/280`;
        count.dataset.over = String(v.text.length > 280);
        angle.textContent = label(v, i);
      });

      out.appendChild(
        el("div", { class: "card", "data-busy": String(!!v.busy) }, [
          angle,
          box,
          v.error ? el("div", { class: "note bad", text: v.error }) : null,
          el("div", { class: "card-foot" }, [
            el("button", { class: "act primary", text: "Use this", onclick: () => use(v) }),
            el("button", {
              class: "act",
              text: state.speakingIndex === i ? "◼ Stop" : "▶ Read",
              "data-on": String(state.speakingIndex === i),
              onclick: () => speak(v.text, i),
            }),
            el("button", {
              class: "act",
              text: v.busy ? "redoing…" : "↻ Redo",
              title: "Rewrite only this draft. If you changed its words, it keeps your changes.",
              onclick: () => redo(i),
            }),
            el("button", { class: "act", text: "Copy", onclick: (e) => copy(v.text, e.target) }),
            count,
          ]),
        ])
      );
      fit(box);
    });

    if (editing) {
      const box = out.querySelector(`.text[data-i="${editing.i}"]`);
      if (box && !box.disabled) {
        box.focus();
        box.setSelectionRange(editing.start, editing.end);
      }
    }
  }

  const label = (v, i) => (v.angle || `version ${i + 1}`) + (v.text !== v.drafted ? " · edited" : "");

  /* ---------------------------------------------------------- actions --- */

  async function generate() {
    if (state.busy) return;
    const seedEl = root.querySelector(".seed");
    const seed = seedEl?.value?.trim() || "";

    if (!hasSubject(state.mode) && !seed) {
      state.error = state.mode === "fix" ? "Paste the text you want cleaned up first." : "Give it something to work from first, even one word.";
      paint();
      return;
    }

    state.busy = true;
    state.error = null;
    render();

    const res = await send("draft", {
      mode: state.mode,
      seed,
      context: state.context,
      chips: [...state.chips],
    });

    state.busy = false;
    if (!res.ok) {
      state.error = res.error;
      state.variants = [];
    } else {
      // drafted is what the model wrote; text is what is in the box, which he
      // may change. The gap between the two is what the voice learns from.
      state.variants = res.data.variants.map((v) => ({ ...v, drafted: v.text }));
      state.error = null;
      const st = root.querySelector(".status");
      if (st) st.textContent = `${(res.data.ms / 1000).toFixed(1)}s`;
    }
    render();
  }

  /** Rewrite one card and leave the other two alone. */
  async function redo(i) {
    const list = state.variants;
    const v = list[i];
    if (!v || v.busy || state.busy) return;
    const edited = v.text.trim() !== v.drafted.trim();

    if (edited) {
      send("accepted", {
        event: "edit",
        mode: state.mode,
        context: state.context,
        drafted: v.drafted,
        edited: v.text,
      });
    }

    v.busy = true;
    v.error = null;
    paint();

    const res = await send("draft", {
      mode: state.mode,
      seed: root.querySelector(".seed")?.value?.trim() || "",
      context: state.context,
      chips: [...state.chips],
      single: true,
      anchor: edited ? v.text : "",
      // An unedited redo must not come back as the card it replaces.
      keep: list.filter((x, j) => j !== i || !edited).map((x) => x.text),
    });

    v.busy = false;
    // A full redraft may have replaced the list while this one was out.
    if (state.variants !== list) return;
    const fresh = res.ok && res.data.variants[0];
    if (fresh) list[i] = { ...fresh, drafted: fresh.text };
    else v.error = res.error || "Couldn't redo this one. Try again.";
    paint();
  }

  async function use(v) {
    const ok = await writeIntoComposer(v.text);
    send("accepted", {
      event: "used",
      mode: state.mode,
      chips: [...state.chips],
      seed: root.querySelector(".seed")?.value || "",
      context: state.context,
      drafted: v.drafted,
      chosen: v.text,
      angle: v.angle,
      alternatives: state.variants.filter((x) => x !== v).map((x) => x.text),
    });
    // Remembered so the post he finally sends can be paired with this draft.
    state.lastUse = { at: Date.now(), mode: state.mode, context: state.context, drafted: v.drafted, used: v.text };
    if (ok) {
      close();
    } else {
      navigator.clipboard.writeText(v.text);
      state.error = "X's box wasn't open, so it's on your clipboard instead. Paste it in.";
      paint();
    }
  }

  async function copy(text, btn) {
    await navigator.clipboard.writeText(text);
    const was = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = was), 1200);
  }

  /** Hearing a draft is faster than rereading it. */
  function speak(text, i) {
    speechSynthesis.cancel();
    if (state.speakingIndex === i) {
      state.speakingIndex = null;
      paint();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => {
      state.speakingIndex = null;
      paint();
    };
    state.speakingIndex = i;
    paint();
    speechSynthesis.speak(u);
  }

  /** Dictation, for when typing the seed is the slow part. */
  function dictate() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = root.querySelector(".mic");
    if (!SR) {
      state.error = "This browser has no speech recognition. Type the seed instead.";
      paint();
      return;
    }
    if (ui?.rec) {
      ui.rec.stop();
      ui.rec = null;
      btn.dataset.on = "false";
      btn.textContent = "🎙 Speak";
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    const seedEl = root.querySelector(".seed");
    const base = seedEl.value ? seedEl.value + " " : "";
    rec.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      seedEl.value = base + s;
      ui = { ...ui, seedValue: seedEl.value };
    };
    rec.onerror = () => {
      btn.dataset.on = "false";
      btn.textContent = "🎙 Speak";
    };
    rec.onend = () => {
      btn.dataset.on = "false";
      btn.textContent = "🎙 Speak";
      if (ui) ui.rec = null;
    };
    rec.start();
    ui = { ...ui, rec };
    btn.dataset.on = "true";
    btn.textContent = "◼ Stop";
  }

  /* ------------------------------------------------------------ boot ---- */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root?.querySelector(".panel")) close();
    // ⌘⇧K anywhere on X opens a fresh post draft
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      state.context = null;
      state.target = null;
      open("post");
    }
  });

  watchForComposeIntent();
  decorate();
  new MutationObserver(() => decorate()).observe(document.body, { childList: true, subtree: true });
})();
