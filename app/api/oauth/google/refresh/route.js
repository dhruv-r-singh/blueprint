import { NextResponse } from "next/server";

// Deprecated: see app/api/oauth/google/callback/route.js. There's no
// refresh-token flow anymore either — a lapsed Drive connection is fixed by
// signing in with Google again (or "Refresh Drive access" in /account),
// which re-runs saveGoogleCredential with a fresh ~1hr access token.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is no longer used — reconnect Google in /account to refresh Drive access." },
    { status: 410 }
  );
}
