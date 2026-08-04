import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { requireUid } from "../../../../../lib/firebaseAdmin";
import { GOOGLE_DESKTOP_SCOPE } from "../../../../../lib/oauthScopes";

// "Connect"/"Refresh Drive access" from Preferences, when running in the
// desktop shell — see ../desktop-start/route.js for why this can't be the
// old embedded-popup linkWithPopup/reauthenticateWithPopup anymore. Needs
// the caller's uid (unlike a fresh sign-in), so this is a POST carrying
// their ID token — same shape as app/api/auth/linkedin/link-start/route.js.
// Returns a URL for the client to open in the system browser (via
// window.blueprintDesktop.openExternal) rather than redirecting itself, so
// the ID token never has to sit in a URL.
export async function POST(request) {
  let uid;
  try {
    uid = await requireUid(request);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("gds_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("gds_link_uid", uid, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/desktop-callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_DESKTOP_SCOPE,
  });

  return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
}
