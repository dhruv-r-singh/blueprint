// Client-side helpers for the app's AI features. Both just call our own
// /api/ai route (see app/api/ai/route.js), which proxies to Google's Gemini
// API — the key lives server-side only, never here.

/** Sends `prompt` to the AI and returns its plain-text reply. Throws with a user-facing message on failure. */
export async function aiComplete(prompt, { system } = {}) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, system }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "AI request failed.");
  return data.text || "";
}

/** Same as aiComplete, but asks the model for JSON and returns it already parsed. */
export async function aiCompleteJSON(prompt, { system } = {}) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, system, json: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "AI request failed.");
  return data.data;
}
