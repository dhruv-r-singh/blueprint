import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

// Kicks off GitHub sign-in for the Electron desktop shell via the system's
// real browser — see app/api/auth/google/desktop-start/route.js for the
// full reasoning (same malware-flag issue, same fix, mirrored for GitHub).
//
// Needs its OWN GitHub OAuth App, separate from whichever one Firebase's
// built-in "github.com" sign-in provider already uses — GitHub OAuth Apps
// (classic) only support a single Authorization callback URL, and that
// existing one is already locked to Firebase's own handler. Create a new
// OAuth App at https://github.com/settings/developers with callback URL
// `<your-domain>/api/auth/github/desktop-callback`, then set
// GITHUB_DESKTOP_CLIENT_ID / GITHUB_DESKTOP_CLIENT_SECRET in Vercel — see
// SETUP_NOTES.md.
export async function GET(request) {
  const url = new URL(request.url);
  const state = crypto.randomBytes(16).toString("hex");
  const returnPath = url.searchParams.get("return") || "/";

  const jar = await cookies();
  jar.set("ghd_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  jar.set("ghd_return", returnPath, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const redirectUri = `${url.origin}/api/auth/github/desktop-callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_DESKTOP_CLIENT_ID || "",
    redirect_uri: redirectUri,
    state,
    scope: "repo read:user user:email",
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
