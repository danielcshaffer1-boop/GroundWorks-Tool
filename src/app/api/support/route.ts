import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { SUPPORT_SYSTEM_PROMPT } from "@/lib/support-prompt";

// In-app help chat. The browser sends the short conversation so far; this
// route checks who is asking and forwards it to Claude with the help-guide
// system prompt. The API key only ever lives here (ANTHROPIC_API_KEY in
// Vercel), never in the browser.
//
// Cost controls: signed-in shops only (not the public demo), Haiku, short
// replies, and hard caps on how much history a request can carry. The
// monthly spend limit in the Claude Console is the final backstop.

const MODEL = "claude-haiku-5-5";
const MAX_REPLY_TOKENS = 300;
const MAX_MESSAGES = 8; // history kept per request (4 back-and-forths)
const MAX_MESSAGE_CHARS = 600;

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) return null;
    messages.push({ role, content: text });
  }
  // Claude expects the conversation to start and end with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.id === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "The help chat is turned off in the demo. The guides at /guides cover everything." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Help chat: ANTHROPIC_API_KEY is not set.");
    return NextResponse.json({ error: "The help chat isn't available right now." }, { status: 503 });
  }

  const messages = parseMessages(await request.json().catch(() => null));
  if (!messages) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_REPLY_TOKENS,
        // Same prompt every call, so let the API cache it (cheaper repeat reads).
        system: [{ type: "text", text: SUPPORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error("Help chat: request to Claude failed:", err);
    return NextResponse.json({ error: "Couldn't reach the help assistant. Try again." }, { status: 502 });
  }

  if (!res.ok) {
    console.error("Help chat: Claude returned", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "The help assistant is busy. Try again in a minute." }, { status: 502 });
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const reply = (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();

  return NextResponse.json({ reply: reply || "Sorry, I don't have an answer for that. Email daniel@groundworksinventory.dev." });
}
