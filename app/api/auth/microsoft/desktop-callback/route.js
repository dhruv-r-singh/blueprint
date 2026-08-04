import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "../../../../../lib/firebaseAdmin";

/**
 * Decodes (does NOT verify signature — we just exchanged this token directly
 * with Microsoft over TLS using our own client secret, so it's already
 * trusted the same way Google's userinfo response is above) the middle
 * segment of a JWT and returns its JSON claims.
 */
function decodeJwtPayload(jwt) {
  const [, payload] = jwt.split(".");
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

// Microsoft redirects back here (in the user's real browser) after they
// approve or deny access — shared by a fresh desktop sign-in
// (../desktop-start/route.js) and "Connect Microsoft" from Preferences
// (../desktop-link-start/route.js), distinguished by the msd_link_uid
// cookie. See app/api/auth/google/desktop-callback/route.js for why this
// hands off via blueprint://auth-callback instead of a normal redirect.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get("msd_state")?.value;
  const linkUid = jar.get("msd_link_uid")?.value || null;
  const returnPath = jar.get("msd_return")?.value || "/";
  jar.delete("msd_state");
  jar.delete("msd_link_uid");
  jar.delete("msd_return");

  function fail(message) {
    const params = new URLSearchParams({ error: message });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  }

  if (oauthError) return fail(oauthError);
  if (!code) return fail("Microsoft didn't return an authorization code.");
  if (!expectedState || state !== expectedState) return fail("Sign-in session expired — try again.");

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("Microsoft sign-in isn't configured on this deployment yet.");

  try {
    const redirectUri = `${url.origin}/api/auth/microsoft/desktop-callback`;
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "openid profile email",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.error("Microsoft desktop token exchange failed:", tokenRes.status, tokenData);
      throw new Error(tokenData.error_description || tokenData.error || "Microsoft token exchange failed.");
    }

    const claims = decodeJwtPayload(tokenData.id_token); // { oid, sub, email, preferred_username, name }
    const email = claims.email || claims.preferred_username || null;
    const name = claims.name || email;
    // Microsoft/Entra ID's stable, tenant-wide account identifier is the
    // "oid" claim — NOT "sub", which is pairwise-unique per application and
    // won't match across a web sign-in and this desktop flow. This is a
    // documented quirk of how Firebase's own "microsoft.com" provider does
    // account linking. If this guess is ever wrong for some account type,
    // the email fallback right below still catches it for anyone who's
    // already signed in on the web with the same email.
    const providerUid = claims.oid || claims.sub;

    async function saveProfile(targetUid) {
      const patch = {};
      if (email) patch.email = email;
      if (name) patch.name = name;
      if (Object.keys(patch).length) {
        await adminDb.doc(`profiles/${targetUid}`).set(patch, { merge: true });
      }
    }

    if (linkUid) {
      await saveProfile(linkUid);
      const params = new URLSearchParams({ linked: "microsoft", next: "/account" });
      return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
    }

    // Fresh sign-in — match the same Firebase user Microsoft web sign-in
    // would have created (by provider UID), falling back to email, falling
    // back to creating a new user.
    let uid;
    try {
      if (!providerUid) throw new Error("no oid/sub claim");
      const existing = await adminAuth.getUserByProviderUid("microsoft.com", providerUid);
      uid = existing.uid;
    } catch {
      try {
        if (!email) throw new Error("no email");
        const byEmail = await adminAuth.getUserByEmail(email);
        uid = byEmail.uid;
      } catch {
        const created = await adminAuth.createUser({
          email: email || undefined,
          emailVerified: Boolean(email),
          displayName: name,
        });
        uid = created.uid;
      }
    }

    await saveProfile(uid);
    const customToken = await adminAuth.createCustomToken(uid);
    const params = new URLSearchParams({ token: customToken, next: returnPath });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  } catch (err) {
    console.error("Microsoft desktop sign-in failed:", err);
    return fail(err.message || "Microsoft sign-in failed — try again.");
  }
}
