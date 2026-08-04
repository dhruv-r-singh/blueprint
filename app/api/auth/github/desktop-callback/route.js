import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "../../../../../lib/firebaseAdmin";

// GitHub redirects back here (in the user's real browser) after they
// approve or deny access — shared by a fresh desktop sign-in
// (../desktop-start/route.js) and "Connect GitHub" from Preferences
// (../desktop-link-start/route.js), distinguished by the ghd_link_uid
// cookie. See app/api/auth/google/desktop-callback/route.js for why this
// hands off via blueprint://auth-callback instead of a normal redirect.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get("ghd_state")?.value;
  const linkUid = jar.get("ghd_link_uid")?.value || null;
  const returnPath = jar.get("ghd_return")?.value || "/";
  jar.delete("ghd_state");
  jar.delete("ghd_link_uid");
  jar.delete("ghd_return");

  function fail(message) {
    const params = new URLSearchParams({ error: message });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  }

  if (oauthError) return fail(oauthError);
  if (!code) return fail("GitHub didn't return an authorization code.");
  if (!expectedState || state !== expectedState) return fail("Sign-in session expired — try again.");

  const clientId = process.env.GITHUB_DESKTOP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_DESKTOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("GitHub sign-in isn't configured on this deployment yet.");

  try {
    const redirectUri = `${url.origin}/api/auth/github/desktop-callback`;
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      console.error("GitHub desktop token exchange failed:", tokenRes.status, tokenData);
      throw new Error(tokenData.error_description || tokenData.error || "GitHub token exchange failed.");
    }
    const accessToken = tokenData.access_token;

    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) throw new Error("Couldn't load the GitHub profile.");
    const ghUser = await userRes.json(); // { id, login, name, email, avatar_url }
    // Same scope-tracking as the web flow (lib/integrations.js's
    // saveGithubCredential) — GitHub echoes exactly which scopes a token
    // carries in this header on every authenticated response.
    const githubScopes = userRes.headers.get("x-oauth-scopes") || "";

    let email = ghUser.email;
    if (!email) {
      try {
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          email = emails.find((e) => e.primary)?.email || emails[0]?.email || null;
        }
      } catch {
        // No email available — non-fatal, just means the profile doc won't
        // get one from this sign-in.
      }
    }

    async function saveGithubAndProfile(targetUid) {
      await adminDb.doc(`profiles/${targetUid}/private/integrations`).set(
        { githubAccessToken: accessToken, githubScopes },
        { merge: true }
      );
      const patch = { githubUsername: ghUser.login };
      if (email) patch.email = email;
      if (ghUser.name) patch.name = ghUser.name;
      if (ghUser.avatar_url) {
        const snap = await adminDb.doc(`profiles/${targetUid}`).get();
        if (!snap.exists || !snap.data()?.avatarUrl) patch.avatarUrl = ghUser.avatar_url;
      }
      await adminDb.doc(`profiles/${targetUid}`).set(patch, { merge: true });
    }

    if (linkUid) {
      await saveGithubAndProfile(linkUid);
      const params = new URLSearchParams({ linked: "github", next: "/account" });
      return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
    }

    // Fresh sign-in — match the same Firebase user GitHub web sign-in would
    // have created (by provider UID — GitHub's numeric user id, as a
    // string), falling back to email, falling back to creating a new user.
    let uid;
    try {
      const existing = await adminAuth.getUserByProviderUid("github.com", String(ghUser.id));
      uid = existing.uid;
    } catch {
      try {
        if (!email) throw new Error("no email");
        const byEmail = await adminAuth.getUserByEmail(email);
        uid = byEmail.uid;
      } catch {
        const created = await adminAuth.createUser({
          email: email || undefined,
          displayName: ghUser.name || ghUser.login,
          photoURL: ghUser.avatar_url,
        });
        uid = created.uid;
      }
    }

    await saveGithubAndProfile(uid);
    const customToken = await adminAuth.createCustomToken(uid);
    const params = new URLSearchParams({ token: customToken, next: returnPath });
    return NextResponse.redirect(`blueprint://auth-callback?${params.toString()}`);
  } catch (err) {
    console.error("GitHub desktop sign-in failed:", err);
    return fail(err.message || "GitHub sign-in failed — try again.");
  }
}
