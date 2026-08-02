import { NextResponse } from "next/server";

// Deprecated: Drive access now comes from the same Google sign-in popup
// (see lib/firebase.js's googleProvider scope + lib/integrations.js's
// saveGoogleCredential), so this standalone authorization-code exchange
// isn't called anymore. Left in place (rather than deleted) as a no-op so
// nothing 404s if something still points here.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is no longer used — Drive access is granted automatically at sign-in. See lib/integrations.js." },
    { status: 410 }
  );
}
