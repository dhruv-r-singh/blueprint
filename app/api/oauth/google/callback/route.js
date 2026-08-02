import { NextResponse } from "next/server";

// Deprecated: this was an earlier, abandoned standalone-OAuth-app approach.
// Drive access now comes from the Google sign-in popup itself (see
// lib/firebase.js's googleProvider scope + lib/integrations.js's
// saveGoogleCredential) for the initial ~1hr token, PLUS a real refresh-token
// flow at app/api/oauth/google/exchange and app/api/oauth/google/refresh for
// keeping it alive indefinitely. This route isn't called anymore. Left in
// place (rather than deleted) as a no-op so nothing 404s if something still
// points here.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is no longer used — Drive access is granted automatically at sign-in. See lib/integrations.js." },
    { status: 410 }
  );
}
