import { NextResponse } from "next/server";

// Free text generation for the app's AI touches (chat summaries, AI-suggested
// roles, etc.) via Google's Gemini API — replaces the earlier Pollinations.ai
// integration, which moved to a pay-as-you-go "Pollen" credit system with
// effectively no free budget for the model this app needs.
//
// Gemini's free tier needs an API key (no credit card — sign in with any
// Google account at aistudio.google.com), but the key itself is free to get
// and the daily quota is generous for light, occasional use like this.
// See SETUP_NOTES.md for how to get one and where to set it.
//
// Routed through our own API route rather than called directly from the
// browser so the key never reaches the client, and so the
// prompt-building/JSON-cleanup logic lives in one place instead of being
// duplicated at every call site. Every caller goes through lib/ai.js's
// aiComplete/aiCompleteJSON either way, so swapping the provider here is the
// only change needed if this ever moves again.
const GEMINI_MODEL = "gemini-2.5-flash";

export async function POST(request) {
  const { prompt, system, json } = await request.json().catch(() => ({}));
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI isn't configured on this deployment yet (missing GEMINI_API_KEY — see SETUP_NOTES.md)." },
      { status: 500 }
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    // Gemini can be told to only ever return valid JSON — much more
    // reliable than asking nicely and stripping markdown fences after.
    ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Gemini request failed:", res.status, data);
      const detail =
        res.status === 429
          ? "Hit the free daily AI limit — try again in a bit."
          : data?.error?.message || `AI service returned ${res.status}.`;
      return NextResponse.json({ error: detail }, { status: res.status === 429 ? 429 : 502 });
    }

    const text = (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
    if (!text) {
      // Most likely the safety filter blocked the response — surface
      // whatever reason Gemini gave rather than a bare "no response".
      const blockReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
      return NextResponse.json(
        { error: blockReason ? `AI declined to respond (${blockReason}).` : "AI didn't return a response." },
        { status: 502 }
      );
    }

    if (json) {
      try {
        return NextResponse.json({ data: JSON.parse(text) });
      } catch {
        return NextResponse.json({ error: "AI didn't return valid JSON." }, { status: 502 });
      }
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("AI request failed:", err);
    return NextResponse.json({ error: "AI request failed — try again." }, { status: 502 });
  }
}
