import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

// Kicks off "Sign in with LinkedIn" via a real, hand-rolled OAuth redirect
// instead of Firebase's built-in "OpenID Connect" sign-in provider.
//
// That built-in path is broken specifically for LinkedIn: Firebase's OIDC
// connector authenticates the token-exchange call with an HTTP Basic Auth
// header, but LinkedIn's token endpoint only accepts the client secret as
// a POST body parameter — so LinkedIn rejects every attempt with
// "A required parameter 'client_secret' is missing", no matter how
// correctly the provider is configured in the Firebase console. This is a
// documented, still-unresolved incompatibility between Firebase Auth and
// LinkedIn's OIDC implementation, not a setup mistake.
//
// This route + ../callback/route.js instead do the OAuth exchange by hand
// — the same approach Firebase's own official "linkedin-auth" Cloud
// Functions sample uses — then mint a Firebase custom token via the Admin
// SDK for the client to sign in with via signInWithCustomToken. Because
// it's a real full-page redirect (not a popup), it also sidesteps any
// popup-blocking weirdness in the Electron shell.
//
// Requires LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET env vars (same
// values already entered in Firebase's OIDC provider config — copy them
// from the LinkedIn Developer Portal's Auth tab). Also requires this
// route's callback URL to be added to LinkedIn's "Authorized redirect
// URLs" for the app, alongside the existing Firebase one — see
// SETUP_NOTES.md.
export async function GET(request) {
  const url = new URL(request.url);
  const returnPath = url.searchParams.get("return") || "/signin";
  const state = crypto.randomBytes(16).toString("hex");

  const jar = await cookies();
  jar.set("li_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("li_return", returnPath, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const redirectUri = `${url.origin}/api/auth/linkedin/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile email",
  });

  return NextResponse.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
}
