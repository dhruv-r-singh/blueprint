import { NextResponse } from "next/server";
import { adminDb, requireUid } from "../../../../../lib/firebaseAdmin";

// Exchanges a Google OAuth "authorization code" — obtained client-side via
// Google Identity Services' code client (see lib/integrations.js's
// connectGoogleOffline), requested with access_type: "offline" — for a real
// access_token + refresh_token pair. The refresh_token gets stored here,
// server-side only, so app/api/oauth/google/refresh/route.js can silently
// mint fresh access tokens forever after, instead of Drive/Calendar access
// dying every ~hour like it used to.
export async function POST(request) {
  let uid;
  try {
    uid = await requireUid(request);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const { code } = await request.json().catch(() => ({}));
  if (!code) return NextResponse.json({ error: "Missing authorization code." }, { status: 400 });

  // Same Client ID as everywhere else in the app (desktop sign-in, the
  // client-side code client in lib/integrations.js) — there's only ever one
  // "second OAuth client" (see SETUP_NOTES.md), so this reads the same
  // NEXT_PUBLIC_-prefixed env var rather than a separate undocumented name.
  // It's safe to read a NEXT_PUBLIC_ var server-side too; the prefix only
  // controls whether it's *also* inlined into client bundles.
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Google OAuth isn't configured on the server yet (missing NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)." },
      { status: 500 }
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      // Matches ux_mode: "popup" on the client's initCodeClient — Google's
      // documented magic value for exchanging a popup-flow code server-side,
      // no registered redirect URI required.
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data.error_description || data.error || "Google token exchange failed." }, { status: 400 });
  }

  if (data.refresh_token) {
    await adminDb.doc(`profiles/${uid}/private/google`).set(
      { refreshToken: data.refresh_token, scope: data.scope || "", updatedAt: Date.now() },
      { merge: true }
    );
  } else {
    // Google only issues a refresh_token on first consent (or when
    // prompt=consent forces re-consent, which connectGoogleOffline always
    // sets) — if one didn't come back and we don't already have one stored,
    // don't pretend this succeeded.
    const existing = await adminDb.doc(`profiles/${uid}/private/google`).get();
    if (!existing.exists || !existing.data()?.refreshToken) {
      return NextResponse.json(
        { error: "Google didn't grant offline access — try reconnecting Google and allowing all the requested permissions." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
}
