import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draft, loadHistory, CHIPS, MODEL } from "./model.mjs";
import { maybeLearn, learningStatus } from "./learn.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = Number(process.env.XCOPILOT_PORT || 8787);

// Load .env by hand so the project has no dependency just for this.
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env is fine if the key is already exported in the shell */
}

// Only X may talk to this server. It's bound to localhost anyway, but this
// stops any other site you have open from quietly using your API key.
const ALLOWED = new Set(["https://x.com", "https://twitter.com", "https://mobile.x.com"]);

// A page can rebind its own domain to 127.0.0.1 (DNS rebinding). The browser
// then counts the request as same-origin and sends no Origin header at all,
// so cors() below waves it through. Pinning Host is what actually stops it.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

function localHost(req) {
  return HOSTS.has((req.headers.host || "").toLowerCase());
}

// The draft call comes from the extension's service worker, not from the page,
// so the Origin that arrives is the extension's own — that is the whole point
// of routing through background.js, it escapes x.com's CSP. The id is not
// pinned because an unpacked extension gets a new one whenever the folder
// moves, and anyone who can install a Chrome extension here already has more
// reach than this server gives them.
function allowed(origin) {
  return ALLOWED.has(origin) || origin.startsWith("chrome-extension://");
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    return true;
  }
  return !origin; // allow curl / same-origin health checks
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Append every accepted draft so the voice file can be sharpened from real data later. */
function logAccepted(entry) {
  const file = path.join(root, "posted.jsonl");
  try {
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) {
    console.error("could not write posted.jsonl:", e.message);
  }
}

const server = http.createServer(async (req, res) => {
  if (!localHost(req)) return json(res, 403, { error: "bad host header" });
  if (!cors(req, res)) return json(res, 403, { error: "origin not allowed" });
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      model: MODEL,
      chips: Object.keys(CHIPS),
      hasKey: Boolean(process.env.OPENAI_API_KEY),
      // How many of his real edits and posts the voice is currently learning from.
      recentEdits: loadHistory().length,
      learning: learningStatus(),
    });
  }

  if (url.pathname === "/draft" && req.method === "POST") {
    const started = Date.now();
    try {
      const body = await readBody(req);
      const result = await draft(body);
      const ms = Date.now() - started;
      console.log(
        `${body.mode || "post"}${body.chips?.length ? ` [${body.chips.join(" ")}]` : ""} ` +
          `→ ${result.variants.length} variant(s) in ${(ms / 1000).toFixed(1)}s ` +
          `(${result.usage.input} in / ${result.usage.output} out, ${result.usage.cached} cached)`
      );
      return json(res, 200, { ...result, ms });
    } catch (e) {
      console.error("draft failed:", e.message);
      const status = e?.status === 401 ? 401 : 500;
      return json(res, status, {
        error:
          status === 401
            ? "Your API key was rejected. Check OPENAI_API_KEY in .env"
            : e.message,
      });
    }
  }

  if (url.pathname === "/accepted" && req.method === "POST") {
    try {
      logAccepted(await readBody(req));
      maybeLearn(); // background; the reply does not wait for it
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const keyed = process.env.OPENAI_API_KEY;
  console.log(`\n  x-copilot listening on http://127.0.0.1:${PORT}`);
  console.log(`  model: ${MODEL}`);
  console.log(keyed ? "  api key: found\n" : "\n  ⚠ No API key found. Put OPENAI_API_KEY in .env, then restart.\n");
  maybeLearn(); // catch up on anything logged while the server was off
});
