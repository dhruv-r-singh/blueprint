import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are the project-scoping engine for Blueprint, a platform that helps engineers and builders find teammates for projects, hackathons, and startups.

Given a project idea, produce a structured breakdown:
1. A one-paragraph brief (2-3 sentences) restating what the project is and why it matters.
2. 3-6 roles this specific project needs. Each role gets a short discipline code (2-4 letters, like real blueprint drawing codes: SW for software, HW for hardware, AI for machine learning, CAD for mechanical/industrial design, BIZ for business/go-to-market, UX for design), a title, and a 1-2 sentence description of what that role actually does on THIS project — be specific to the idea given, not generic.
3. An initial task list of 8-14 concrete tasks to get the project moving, each tagged with the role_code of whoever would own it.

Respond with ONLY valid JSON, no markdown code fences, no explanation before or after, matching exactly this shape:
{"brief": "string", "roles": [{"code": "string", "title": "string", "description": "string"}], "tasks": [{"title": "string", "role_code": "string"}]}`;

export async function POST(req) {
  let idea;
  try {
    const body = await req.json();
    idea = body.idea;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!idea || typeof idea !== "string" || idea.trim().length < 10) {
    return NextResponse.json(
      { error: "Describe your project idea in a bit more detail." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI decomposition isn't configured yet — missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: idea.trim() }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic API error:", res.status, errText);
      return NextResponse.json(
        { error: "The decomposition request failed. Try again." },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse decomposition JSON:", raw);
      return NextResponse.json(
        { error: "Couldn't parse the breakdown. Try rephrasing your idea." },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong reaching the AI service." },
      { status: 500 }
    );
  }
}
