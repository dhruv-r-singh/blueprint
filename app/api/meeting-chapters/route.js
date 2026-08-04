import { NextResponse } from "next/server";

// AI-generated chapter markers for a meeting recording — same idea as
// YouTube's auto-chapters. Meeting recordings are full video/webm files
// (see project/[id]/VideoCall.js's local recording), which routinely blow
// past the ~15MB inline-request limit app/api/transcribe/route.js relies on
// for short voice messages, so this uses Gemini's File API instead: upload
// the video once (resumable upload protocol), wait for it to finish
// processing, then ask Gemini to watch it and return chapter markers
// grounded in the actual video timestamps (Gemini natively understands
// MM:SS references within a video it's been given this way — no separate
// transcript-with-timestamps step needed).
const GEMINI_MODEL = "gemini-flash-latest";
const MAX_BYTES = 200 * 1024 * 1024; // 200MB — generous for a recorded meeting, well under Gemini's 2GB per-file cap

// Longer-running than the other AI routes (upload + processing wait +
// generation) — ask Vercel for more time. Hobby plans cap this at 60s;
// if a meeting recording is long enough to blow past that, the request
// will just time out and the user can retry (Gemini's upload isn't lost —
// see the cleanup note below).
export const maxDuration = 60;

export async function POST(request) {
  const { url } = await request.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: "Missing recording URL." }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI isn't configured on this deployment yet (missing GEMINI_API_KEY — see SETUP_NOTES.md)." },
      { status: 500 }
    );
  }

  let uploadedFileName = null;
  try {
    const videoRes = await fetch(url);
    if (!videoRes.ok) throw new Error("Couldn't load that recording.");
    const buf = Buffer.from(await videoRes.arrayBuffer());
    if (buf.length < 2000) throw new Error("That recording's too short to chapter.");
    if (buf.length > MAX_BYTES) throw new Error("That recording's too long to chapter (200MB limit).");

    // 1) Start a resumable upload session with Gemini's File API.
    const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
      method: "POST",
      headers: {
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(buf.length),
        "x-goog-upload-header-content-type": "video/webm",
        "content-type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: `meeting-${Date.now()}` } }),
    });
    if (!startRes.ok) {
      const errData = await startRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || "Couldn't start the AI upload.");
    }
    const uploadUrl = startRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("Couldn't start the AI upload (no upload URL returned).");

    // 2) Upload the actual video bytes and finalize in one request.
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "content-length": String(buf.length),
        "x-goog-upload-offset": "0",
        "x-goog-upload-command": "upload, finalize",
      },
      body: buf,
    });
    if (!uploadRes.ok) {
      const errData = await uploadRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || "Couldn't upload the recording to the AI.");
    }
    let file = (await uploadRes.json()).file;
    if (!file?.uri) throw new Error("The AI didn't accept that recording.");
    uploadedFileName = file.name;

    // 3) Wait for Gemini to finish processing the video (usually just a
    // few seconds) — it can't be referenced in generateContent until then.
    const deadline = Date.now() + 45_000;
    while (file.state === "PROCESSING" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`);
      file = await checkRes.json().catch(() => file);
    }
    if (file.state !== "ACTIVE") throw new Error("The AI is still processing that recording — try again in a minute.");

    // 4) Ask Gemini to watch it and return chapter markers.
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
                    "Watch this recorded meeting and split it into chapters, the way YouTube auto-chapters work: " +
                    "short, topic-based section titles (3-6 words each) anchored to the moment each topic actually " +
                    "starts. Cover the entire recording start to finish. The first chapter must start at 0:00. Use " +
                    "as many chapters as the content actually supports — don't pad with filler, and don't force " +
                    "multiple chapters onto a meeting that's really just one continuous topic (one chapter is fine " +
                    "if that's accurate). Return ONLY a JSON array, no markdown code fences, no commentary, in " +
                    'exactly this shape: [{"time":"0:00","title":"Kickoff and agenda"},{"time":"3:42","title":"Budget review"}]. ' +
                    'Times must be "M:SS" or "H:MM:SS", matching the actual video timestamps.',
                },
                { fileData: { mimeType: "video/webm", fileUri: file.uri } },
              ],
            },
          ],
        }),
      }
    );
    const data = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      console.error("Gemini chapters request failed:", geminiRes.status, data);
      const detail =
        geminiRes.status === 429
          ? "Hit the free daily AI limit — try again in a bit."
          : data?.error?.message || `AI service returned ${geminiRes.status}.`;
      return NextResponse.json({ error: detail }, { status: geminiRes.status === 429 ? 429 : 502 });
    }

    let text = (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
    text = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let chapters;
    try {
      chapters = JSON.parse(text);
    } catch {
      throw new Error("The AI's response wasn't in the expected format — try again.");
    }
    if (!Array.isArray(chapters) || chapters.length === 0) {
      throw new Error("Couldn't find any chapters in that recording.");
    }
    chapters = chapters
      .filter((c) => c && typeof c.time === "string" && typeof c.title === "string")
      .map((c) => ({ time: c.time.trim(), title: c.title.trim(), seconds: parseTimeToSeconds(c.time) }));
    if (chapters.length === 0) throw new Error("Couldn't find any chapters in that recording.");

    return NextResponse.json({ chapters });
  } catch (err) {
    console.error("Chapter generation failed:", err);
    return NextResponse.json({ error: err.message || "Couldn't generate chapters — try again." }, { status: 502 });
  } finally {
    // Best-effort cleanup — Gemini auto-deletes uploaded files after 48h
    // anyway, so a failure here (or the process getting killed by a
    // timeout before this runs) is harmless either way.
    if (uploadedFileName) {
      fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${apiKey}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

function parseTimeToSeconds(t) {
  const parts = t.split(":").map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}
