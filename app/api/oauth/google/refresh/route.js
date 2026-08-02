import { NextResponse } from "next/server";

// Google Drive access tokens expire in ~1hr. This exchanges the stored
// refresh_token for a new access_token so a Drive connection keeps working
// without the user re-consenting every hour.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { refreshToken } = body;
  if (!refreshToken) {
    return NextResponse.json({ error: "Missing refreshToken." }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google Drive isn't configured yet." }, { status: 500 });
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Google token refresh failed:", data);
      return NextResponse.json({ error: data.error_description || "Refresh failed." }, { status: 502 });
    }
    return NextResponse.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't reach Google's token endpoint." }, { status: 500 });
  }
}
