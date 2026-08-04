import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

// Kicks off Microsoft sign-in for the Electron desktop shell via the
// system's real browser — see app/api/auth/google/desktop-start/route.js
// for the full reasoning (same malware-flag issue, same fix, mirrored for
// Microsoft). Firebase's own "microsoft.com" provider only works with
// signInWithPopup, which the desktop shell can't complete (main.js redirects
// any popup out to the real browser, with no way back in) — so this is a
// hand-rolled OAuth 2.0 code flow against Microsoft's identity platform
// directly, landing back in the app via blueprint://auth-callback.
//
// Reuses the SAME Azure AD app registration already configured for
// Firebase's web "Continue with Microsoft" button — unlike GitHub, Azure app
// registrations support multiple redirect URIs on one app, so no second app
// registration is needed. Just add this route's redirect URI to it (see
// SETUP_NOTES.md) and copy its Application (client) ID/secret into
// MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET.
export async function GET(request) {
  const url = new URL(request.url);
  const state = crypto.randomBytes(16).toString("hex");
  const returnPath = url.searchParams.get("return") || "/";

  const jar = await cookies();
  jar.set("msd_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("msd_return", returnPath, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const redirectUri = `${url.origin}/api/auth/microsoft/desktop-callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile email",
    prompt: "select_account",
  });

  return NextResponse.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
}
