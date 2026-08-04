import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "../../../../../lib/firebaseAdmin";

// Google redirects back here (in the user's real browser, not the Electron
// window) after they approve or deny access — shared by both a fresh
// desktop sign-in (../desktop-start/route.js) and "Connect"/"Refresh" from
// Preferences (../desktop-link-start/route.js), distinguished by the
// gds_link_uid cookie. Either way, this hands off to the Electron app via a
// blueprint://auth-callback link, which the OS routes straight into the
// desktop shell (see electron/main.js) — never back to a page on the site
// itself, since the browser completing this flow is the user's real one.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get("gds_state")?.value;
  const linkUid = jar.get("gds_link_uid")?.value || null;
  const returnPath = jar.get("gds_return")?.value || "/";
  jar.delete("gds_state");
  jar.delete("gds_link_uid");
  jar.delete("gds_return");

  function fail(message) {
    const params = new URLSearchParams({ error: message });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  }

  if (oauthError) return fail(oauthError);
  if (!code) return fail("Google didn't return an authorization code.");
  if (!expectedState || state !== expectedState) return fail("Sign-in session expired — try again.");

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("Google sign-in isn't configured on this deployment yet.");

  try {
    const redirectUri = `${url.origin}/api/auth/google/desktop-callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Google desktop token exchange failed:", tokenRes.status, tokenData);
      throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed.");
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error("Couldn't load the Google profile.");
    const profile = await userRes.json(); // { sub, email, name, picture, email_verified }
    const driveExpiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    async function saveDriveAndProfile(targetUid) {
      await adminDb.doc(`profiles/${targetUid}/private/integrations`).set(
        { driveAccessToken: tokenData.access_token, driveTokenExpiresAt: driveExpiresAt },
        { merge: true }
      );
      if (tokenData.refresh_token) {
        await adminDb.doc(`profiles/${targetUid}/private/google`).set(
          { refreshToken: tokenData.refresh_token, scope: tokenData.scope || "", updatedAt: Date.now() },
          { merge: true }
        );
      }
      const patch = { email: profile.email, name: profile.name };
      if (profile.picture) {
        const snap = await adminDb.doc(`profiles/${targetUid}`).get();
        if (!snap.exists || !snap.data()?.avatarUrl) patch.avatarUrl = profile.picture;
      }
      await adminDb.doc(`profiles/${targetUid}`).set(patch, { merge: true });
    }

    if (linkUid) {
      await saveDriveAndProfile(linkUid);
      const params = new URLSearchParams({ linked: "google", next: "/account" });
      return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
    }

    // Fresh sign-in — match the same Firebase user Google web sign-in would
    // have created (by provider UID, since a real google.com provider
    // identity already exists for anyone who's signed in on the web
    // before), falling back to email, falling back to creating a new user.
    // getUserByProviderUid needs a reasonably recent firebase-admin — if
    // it's missing, this just falls through to the email lookup instead.
    let uid;
    try {
      const existing = await adminAuth.getUserByProviderUid("google.com", profile.sub);
      uid = existing.uid;
    } catch {
      try {
        const byEmail = await adminAuth.getUserByEmail(profile.email);
        uid = byEmail.uid;
      } catch {
        const created = await adminAuth.createUser({
          email: profile.email,
          emailVerified: Boolean(profile.email_verified),
          displayName: profile.name,
          photoURL: profile.picture,
        });
        uid = created.uid;
      }
    }

    await saveDriveAndProfile(uid);
    const customToken = await adminAuth.createCustomToken(uid);
    const params = new URLSearchParams({ token: customToken, next: returnPath });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  } catch (err) {
    console.error("Google desktop sign-in failed:", err);
    return fail(err.message || "Google sign-in failed — try again.");
  }
}
