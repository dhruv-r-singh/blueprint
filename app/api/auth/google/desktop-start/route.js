import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { GOOGLE_DESKTOP_SCOPE } from "../../../../../lib/oauthScopes";

// Kicks off Google sign-in for the Electron desktop shell via the system's
// real browser — NOT an embedded Electron window. The old approach loaded
// Google's login page inside a popup with a spoofed Chrome user-agent (the
// "standard" fix for Google's "disallowed_useragent" block); that
// combination — a fake-browser window loading a real Google login screen —
// is exactly the shape of a credential-phishing attack, which is why
// macOS's malware scanner started deleting the app outright instead of
// just warning about it being unsigned. See lib/desktopAuth.js for the
// full story and electron/main.js for the blueprint:// handoff back into
// the app once this completes.
//
// Reuses the same OAuth Client ID/secret as the Drive/Calendar
// offline-refresh flow (NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
// — see SETUP_NOTES.md's "Drive/Calendar tokens now refresh themselves"
// section), just with a real redirect_uri this time instead of popup mode.
// One new setup step: add this route's redirect URI to that same OAuth
// Client ID's "Authorized
// redirect URIs" in Google Cloud Console — see SETUP_NOTES.md.
export async function GET(request) {
  const url = new URL(request.url);
  const state = crypto.randomBytes(16).toString("hex");
  const returnPath = url.searchParams.get("return") || "/";

  const jar = await cookies();
  jar.set("gds_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("gds_return", returnPath, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

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

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
