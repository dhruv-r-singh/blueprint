import { NextResponse } from "next/server";

// Free, keyless text generation for the app's AI touches (chat summaries,
// AI-suggested roles, etc.) — proxied server-side through Pollinations.ai's
// public text endpoint (https://text.pollinations.ai), which requires no
// signup, no API key, and no billing (same "call a free public endpoint
// server-side" pattern already used by /api/translate for Google Translate).
// Routed through our own API route rather than called directly from the
// browser so the prompt-building/JSON-cleanup logic lives in one place and
// isn't duplicated at every call site.
//
// Trade-off, worth knowing: this is a free community-run proxy, not a
// contracted provider — no uptime/rate-limit guarantees, and quality is
// whatever the underlying model gives you. If this ever needs to become a
// production-grade AI feature, swap the fetch below for a real provider's
// SDK (Claude, OpenAI, etc. — will need an API key at that point) and
// nothing else in the app changes, since every caller goes through
// lib/ai.js's aiComplete/aiCompleteJSON either way.
export async function POST(request) {
  const { prompt, system, json } = await request.json().catch(() => ({}));
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  const fullPrompt = [system, json ? "Respond with ONLY valid JSON — no prose, no markdown code fences." : null, prompt]
    .filter(Boolean)
    .join("\n\n");

  try {
    // Pollinations moved to a Pollen-credit system — the anonymous/no-key
    // tier only gets a small free weekly budget, which isn't enough for
    // the "openai" model (shows up as a 402 Payment Required). A free
    // account (no credit card) at https://enter.pollinations.ai gets you
    // an API key with a real free-tier budget — set it as the
    // POLLINATIONS_API_KEY env var in Vercel and it'll be used
    // automatically; without it, this still tries anonymously, which may
    // work for lighter/default models but not "openai" specifically.
    const key = process.env.POLLINATIONS_API_KEY;
    const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;
    const res = await fetch(url, {
      headers: {
        accept: "text/plain",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
    });
    if (!res.ok) {
      const detail =
        res.status === 402
          ? "The free AI service's credit budget is exhausted (set POLLINATIONS_API_KEY for a real free-tier budget)."
          : `AI service returned ${res.status}.`;
      return NextResponse.json({ error: detail }, { status: 502 });
    }
    const text = (await res.text()).trim();

    if (json) {
      // The model sometimes wraps JSON in a markdown code fence despite
      // being told not to — strip that before parsing rather than fail.
      const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      try {
        return NextResponse.json({ data: JSON.parse(cleaned) });
      } catch {
        return NextResponse.json({ error: "AI didn't return valid JSON." }, { status: 502 });
      }
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("AI request failed:", err);
    return NextResponse.json({ error: "AI request failed — the free AI service may be temporarily down." }, { status: 502 });
  }
}
