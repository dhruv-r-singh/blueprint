import { NextResponse } from "next/server";

// On-demand voice message transcription — same free-tier Gemini key as the
// rest of the app's AI features (app/api/ai/route.js), since the "flash"
// models can read audio directly (inline base64 in the request body), not
// just text. Nothing new to set up beyond GEMINI_API_KEY — see
// SETUP_NOTES.md's "AI features" section.
const GEMINI_MODEL = "gemini-flash-latest";

export async function POST(request) {
  const { url } = await request.json().catch(() => ({}));
  if (!url) {
    return NextResponse.json({ error: "Missing audio URL." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI isn't configured on this deployment yet (missing GEMINI_API_KEY — see SETUP_NOTES.md)." },
      { status: 500 }
    );
  }

  try {
    // Voice messages are recorded client-side as audio/webm (see
    // startVoiceRecording in project/[id]/page.js) and stored in Firebase
    // Storage — fetched server-side here so the (base64-inflated) audio
    // bytes never have to round-trip through the browser twice.
    const audioRes = await fetch(url);
    if (!audioRes.ok) throw new Error("Couldn't load that voice message.");
    const buf = Buffer.from(await audioRes.arrayBuffer());
    if (buf.length < 500) throw new Error("That recording's too short to transcribe.");
    if (buf.length > 15 * 1024 * 1024) throw new Error("That recording's too long to transcribe (15MB limit).");
    const base64Audio = buf.toString("base64");

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    "Transcribe this audio recording verbatim, in the language it's spoken in. Return only the transcription itself — no preamble, no labels, no commentary. If it's silent or unintelligible, return exactly: [inaudible]",
                },
                { inlineData: { mimeType: "audio/webm", data: base64Audio } },
              ],
            },
          ],
        }),
      }
    );
    const data = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      console.error("Gemini transcription request failed:", geminiRes.status, data);
      const detail =
        geminiRes.status === 429
          ? "Hit the free daily AI limit — try again in a bit."
          : data?.error?.message || `AI service returned ${geminiRes.status}.`;
      return NextResponse.json({ error: detail }, { status: geminiRes.status === 429 ? 429 : 502 });
    }

    const text = (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
    if (!text) {
      const blockReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
      return NextResponse.json(
        { error: blockReason ? `AI declined to transcribe (${blockReason}).` : "Couldn't transcribe that recording." },
        { status: 502 }
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("Transcription failed:", err);
    return NextResponse.json({ error: err.message || "Couldn't transcribe that recording — try again." }, { status: 502 });
  }
}
