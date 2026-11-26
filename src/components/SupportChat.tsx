"use client";

import { useEffect, useRef, useState } from "react";
import { CircleQuestionMark, SendHorizontal, X } from "lucide-react";

// Floating "Help" button for signed-in shops. Opens a small chat that asks
// /api/support (Claude, answering from the help guide). The conversation lives
// only in this component's state: closing the page starts fresh, which also
// keeps each request short and cheap.

type ChatMessage = { role: "user" | "assistant"; content: string };

const GREETING = "Hi! Ask me anything about using GroundWorks: counts, deliveries, alerts, the Order tab, recipes or Square.";
const MAX_INPUT = 600;

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) {
        setError(data.error ?? "Something went wrong. Try again.");
        // Put the question back so it can be resent.
        setMessages(messages);
        setInput(text);
      } else {
        setMessages([...next, { role: "assistant", content: stripMarkdown(data.reply) }]);
      }
    } catch {
      setError("Couldn't connect. Check the Wi-Fi and try again.");
      setMessages(messages);
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="GroundWorks help"
          className="fixed right-4 bottom-36 z-30 flex flex-col rounded-lg border shadow-2xl"
          style={{
            width: "min(22rem, calc(100vw - 2rem))",
            maxHeight: "min(32rem, calc(100dvh - 11rem))",
            borderColor: "var(--gw-border-strong)",
            backgroundColor: "var(--gw-surface-raised)",
          }}
        >
          <div className="flex items-center justify-between border-b pl-4 pr-1" style={{ borderColor: "var(--gw-border)" }}>
            <span className="font-mono text-sm font-semibold" style={{ color: "var(--gw-text)" }}>
              Help
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close help"
              className="min-h-11 min-w-11 inline-flex items-center justify-center"
              style={{ color: "var(--gw-text-2)" }}
            >
              <X size={18} />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 text-sm" aria-live="polite">
            <Bubble role="assistant" text={GREETING} />
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.content} />
            ))}
            {sending && <Bubble role="assistant" text="…" />}
            {error && (
              <p className="px-1 text-xs" style={{ color: "var(--gw-danger-text)" }}>
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 border-t p-2"
            style={{ borderColor: "var(--gw-border)" }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Ask a question…"
              aria-label="Your question"
              className="flex-1 resize-none rounded-md border px-3 py-2 text-base sm:text-sm outline-none"
              style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-bg)", color: "var(--gw-text)" }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md disabled:opacity-40"
              style={{ backgroundColor: "var(--gw-accent)", color: "#fff" }}
            >
              <SendHorizontal size={18} />
            </button>
          </form>
          <p className="px-3 pb-2 text-[11px]" style={{ color: "var(--gw-text-3)" }}>
            AI answers from the GroundWorks guides. Still stuck? daniel@groundworksinventory.dev
          </p>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close help" : "Open help"}
        aria-expanded={open}
        className="fixed right-4 bottom-20 z-30 inline-flex items-center gap-2 rounded-full border px-4 min-h-11 font-mono text-sm font-semibold shadow-lg"
        style={{ borderColor: "var(--gw-border-strong)", backgroundColor: "var(--gw-surface-raised)", color: "var(--gw-text)" }}
      >
        <CircleQuestionMark size={18} style={{ color: "var(--gw-accent-text)" }} />
        Help
      </button>
    </>
  );
}

// The prompt asks for plain text, but strip stray markdown in case it slips in.
function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*-]\s+/gm, "• ");
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className="max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2"
        style={{
          backgroundColor: mine ? "var(--gw-surface-selected)" : "var(--gw-bg)",
          color: "var(--gw-text)",
          border: "1px solid var(--gw-border-faint)",
        }}
      >
        {text}
      </p>
    </div>
  );
}
