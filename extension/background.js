// All network calls go through here rather than straight from the content
// script. The service worker isn't bound by x.com's content security policy,
// so this keeps the extension working even when X tightens its headers.

const SERVER = "http://127.0.0.1:8787";

async function call(pathname, body) {
  const res = await fetch(SERVER + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Server sent something unreadable." }));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "draft") {
        sendResponse({ ok: true, data: await call("/draft", msg.payload) });
      } else if (msg.type === "accepted") {
        sendResponse({ ok: true, data: await call("/accepted", msg.payload) });
      } else if (msg.type === "health") {
        const res = await fetch(SERVER + "/health");
        sendResponse({ ok: true, data: await res.json() });
      }
    } catch (e) {
      const offline = e instanceof TypeError || /fetch/i.test(e.message);
      sendResponse({
        ok: false,
        error: offline
          ? "Can't reach the server. Run `npm start` in the x-copilot folder."
          : e.message,
      });
    }
  })();
  return true; // keep the channel open for the async reply
});
