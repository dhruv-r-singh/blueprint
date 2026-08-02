import { NextResponse } from "next/server";

// Deprecated: see app/api/oauth/google/callback/route.js — same story for
// GitHub. Repo access now comes from the same GitHub sign-in/link popup via
// githubProvider's "repo" scope + saveGithubCredential.
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is no longer used — repo access is granted automatically at sign-in. See lib/integrations.js." },
    { status: 410 }
  );
}
