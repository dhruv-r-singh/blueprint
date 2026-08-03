import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "../../../../../lib/firebaseAdmin";

// See ../start/route.js for why this hand-rolled flow exists instead of
// Firebase's built-in OIDC provider. This is the callback LinkedIn redirects
// back to after the user approves (or denies) access.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get("li_state")?.value;
  const returnPath = jar.get("li_return")?.value || "/signin";
  jar.delete("li_state");
  jar.delete("li_return");

  function fail(message) {
    const dest = new URL(returnPath, url.origin);
    dest.searchParams.set("linkedinError", message);
    return NextResponse.redirect(dest);
  }

  if (oauthError) return fail(oauthError);
  if (!code) return fail("LinkedIn didn't return an authorization code.");
  if (!expectedState || state !== expectedState) return fail("Sign-in session expired — please try LinkedIn again.");

  try {
    const redirectUri = `${url.origin}/api/auth/linkedin/callback`;

    // Exchange the code for an access token — client_secret goes in the
    // POST body here (application/x-www-form-urlencoded), which is what
    // LinkedIn actually requires and what Firebase's built-in connector
    // fails to do.
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID || "",
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
      }),
    });
    if (!tokenRes.ok) {
      console.error("LinkedIn token exchange failed:", tokenRes.status, await tokenRes.text());
      throw new Error("LinkedIn token exchange failed.");
    }
    const { access_token: accessToken } = await tokenRes.json();

    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      console.error("LinkedIn profile fetch failed:", profileRes.status, await profileRes.text());
      throw new Error("LinkedIn profile fetch failed.");
    }
    const profile = await profileRes.json();

    // Namespaced uid (same scheme as Firebase's own LinkedIn sample) so it
    // can never collide with a Google/GitHub uid for the same person.
    const uid = `linkedin:${profile.sub}`;
    const userPatch = {
      displayName: profile.name,
      photoURL: profile.picture,
      email: profile.email,
      emailVerified: Boolean(profile.email_verified),
    };
    try {
      await adminAuth.updateUser(uid, userPatch);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        await adminAuth.createUser({ uid, ...userPatch });
      } else {
        throw err;
      }
    }
    const customToken = await adminAuth.createCustomToken(uid);

    const dest = new URL(returnPath, url.origin);
    dest.searchParams.set("linkedinToken", customToken);
    return NextResponse.redirect(dest);
  } catch (err) {
    console.error("LinkedIn sign-in failed:", err);
    return fail("LinkedIn sign-in failed — please try again.");
  }
}
