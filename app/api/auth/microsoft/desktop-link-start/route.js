import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { requireUid } from "../../../../../lib/firebaseAdmin";

// "Connect Microsoft" from Preferences, when running in the desktop shell —
// see ../desktop-start/route.js for the app-registration requirement, and
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
  jar.set("msd_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("msd_link_uid", uid, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/microsoft/desktop-callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "openid profile email",
    prompt: "select_account",
  });

  return NextResponse.json({ url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}` });
}
