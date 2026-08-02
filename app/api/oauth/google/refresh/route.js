import { NextResponse } from "next/server";
import { adminDb, requireUid } from "../../../../../lib/firebaseAdmin";

// Silently mints a fresh Drive/Calendar access token from the refresh token
// captured once by app/api/oauth/google/exchange/route.js. This is what
// lib/integrations.js's ensureFreshGoogleToken calls whenever the short-lived
// access token from sign-in (or a prior refresh) has expired — no popup, no
// "reconnect" prompt, as long as offline access was granted at least once.
export async function POST(request) {
  let uid;
  try {
    uid = await requireUid(request);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const snap = await adminDb.doc(`profiles/${uid}/private/google`).get();
  const refreshToken = snap.data()?.refreshToken;
  if (!refreshToken) {
    return NextResponse.json(
      { error: "Google Drive isn't connected yet — connect it once in Preferences." },
      { status: 404 }
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Google OAuth isn't configured on the server yet (missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)." },
      { status: 500 }
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      // Refresh token was revoked (user removed app access on Google's end,
      // or it just went stale) — clear it so the UI can prompt a clean
      // reconnect instead of failing silently forever.
      await adminDb.doc(`profiles/${uid}/private/google`).delete().catch(() => {});
      return NextResponse.json({ error: "Google access was revoked — reconnect Google in Preferences." }, { status: 401 });
    }
    return NextResponse.json({ error: data.error_description || data.error || "Couldn't refresh Google access." }, { status: 400 });
  }

  return NextResponse.json({
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
}
