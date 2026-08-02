import { NextResponse } from "next/server";

// Exchanges a GitHub OAuth "authorization code" for an access token.
// Classic GitHub OAuth App tokens don't expire, so unlike Google there's no
// refresh flow needed here.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { code, redirectUri } = body;
  if (!code) {
    return NextResponse.json({ error: "Missing code." }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GitHub integration isn't configured yet — missing NEXT_PUBLIC_GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || "",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      console.error("GitHub token exchange failed:", data);
      return NextResponse.json({ error: data.error_description || data.error || "Token exchange failed." }, { status: 502 });
    }

    return NextResponse.json({ access_token: data.access_token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't reach GitHub's token endpoint." }, { status: 500 });
  }
}
