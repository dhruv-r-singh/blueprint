import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { requireUid } from "../../../../../lib/firebaseAdmin";

// "Connect GitHub" from Preferences, when running in the desktop shell —
// see ../desktop-start/route.js for the OAuth App requirement, and
// app/api/auth/google/desktop-link-start/route.js for why this is a POST
// returning a URL rather than a redirect (needs the caller's ID token,
// which a plain GET redirect can't carry).
export async function POST(request) {
  let uid;
  try {
    uid = await requireUid(request);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("ghd_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("ghd_link_uid", uid, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/github/desktop-callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_DESKTOP_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "repo read:user user:email",
  });

  return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
}
