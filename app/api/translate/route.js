import { NextResponse } from "next/server";
import { translate } from "@vitalets/google-translate-api";

// Translates a chat message on demand for whoever clicked "Translate" — this
// is a per-viewer convenience, not a stored/broadcast translation, so it's a
// plain stateless API call: text in, translated text out.
//
// Uses @vitalets/google-translate-api — an unofficial library that calls the
// same free endpoint translate.google.com itself uses, no API key or GCP
// billing required. Trade-off, straight from that library's own README: it's
// not officially supported, and Google rate-limits it (a 429
// "TooManyRequestsError") if too many requests come from the same IP —
// including, notably, a shared IP a serverless host like Vercel might be
// using. If translations start failing under load, that's almost certainly
// why; the library supports routing through a proxy to work around it (see
// its README), or you can swap back to the paid Cloud Translation API (see
// the git history of this file / SETUP_NOTES.md for that version) for a
// guaranteed-uptime alternative.
export async function POST(request) {
  const { text, target } = await request.json().catch(() => ({}));
  if (!text || !target) {
    return NextResponse.json({ error: "Missing text or target language." }, { status: 400 });
  }

  try {
    const result = await translate(text, { to: target });
    const detected = result?.from?.language?.iso || null;
    return NextResponse.json({ translatedText: result.text, detected, sameLanguage: Boolean(detected && detected === target) });
  } catch (err) {
    console.error("Translate request failed:", err);
    if (err.name === "TooManyRequestsError") {
      return NextResponse.json({ error: "Google is rate-limiting translations from this server right now — try again in a bit." }, { status: 429 });
    }
    return NextResponse.json({ error: "Translation failed." }, { status: 500 });
  }
}
