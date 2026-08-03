import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { requireUid } from "../../../../../lib/firebaseAdmin";

// "Connect LinkedIn" from Preferences — same hand-rolled OAuth redirect as
// ../start/route.js (see that file for why Firebase's built-in OIDC
// provider can't be used for LinkedIn at all: it authenticates the token
// exchange with an HTTP Basic Auth header, LinkedIn's token endpoint only
// accepts the client secret as a POST body param). This is for an
// already-signed-in user attaching LinkedIn to their existing account,
// rather than signing in fresh.
//
// Firebase Auth has no supported way to attach an arbitrary OIDC identity to
// an existing user from the server — linkWithCredential is client-only, and
// needs exactly the credential verification Firebase's built-in connector
// can't do for LinkedIn. So rather than fighting that, ../callback/route.js
// just saves the LinkedIn profile straight onto
// profiles/{uid}/private/integrations (same place the Google/GitHub tokens
// already live) when it sees this was a "link" request, not a sign-in one.
// "Connected" then means "we have that doc," not "Firebase Auth has a
// linkedin.com provider entry" — see account/page.js and profile/page.js.
//
// POST (not a GET redirect like ../start) because it needs the caller's ID
// token to know *which* uid to link onto. Sent as a normal Authorization
// header and verified via the Admin SDK, then stashed in a short-lived
// httpOnly cookie so ../callback/route.js — reached via a real cross-site
// redirect from LinkedIn, which can't carry an Authorization header — can
// read it back out.
export async function POST(request) {
  let uid;
  try {
    uid = await requireUid(request);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const { returnPath: rawReturn } = await request.json().catch(() => ({}));
  const returnPath = rawReturn || "/account";
  const state = crypto.randomBytes(16).toString("hex");

  const jar = await cookies();
  jar.set("li_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("li_return", returnPath, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("li_link_uid", uid, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/linkedin/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile email",
  });

  return NextResponse.json({ url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}` });
}
