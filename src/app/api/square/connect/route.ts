import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl, squareConfigured } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

// Starts the Square OAuth flow. Returns the Square authorization URL for the
// browser to go to; a random `state` is remembered in an httpOnly cookie so
// the callback can prove the redirect back is the one this browser started.
export async function POST(request: NextRequest) {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;
  if (!squareConfigured()) {
    return NextResponse.json({ error: "Square isn't set up on this server yet." }, { status: 503 });
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = `${request.nextUrl.origin}/api/square/callback`;
  const res = NextResponse.json({ url: buildAuthorizeUrl(state, redirectUri) });
  res.cookies.set("sq_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/square",
    maxAge: 600,
  });
  return res;
}
