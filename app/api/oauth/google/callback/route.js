import { NextResponse } from "next/server";

// Exchanges a Google OAuth "authorization code" for tokens. The client
// secret has to stay server-side, so this one round-trip is the only part
// of the Drive integration that isn't pure client-side Firestore/API calls.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { code, redirectUri } = body;
  if (!code || !redirectUri) {
    return NextResponse.json({ error: "Missing code or redirectUri." }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Google Drive isn't configured yet — missing NEXT_PUBLIC_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
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

    const data = await res.json();
    if (!res.ok) {
      console.error("Google token exchange failed:", data);
      return NextResponse.json({ error: data.error_description || "Token exchange failed." }, { status: 502 });
    }

    return NextResponse.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_in: data.expires_in,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't reach Google's token endpoint." }, { status: 500 });
  }
}
