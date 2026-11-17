"use client";

import { useRef, useState, useEffect, type FormEvent } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import type { JobContext } from "@/lib/chatbot/knowledgeBase";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  job?: JobContext;
  lang?: "en" | "zh";
};

const WELCOME: Record<string, string> = {
  en: "Hello! 👋 I'm the Avelthorne People Group hiring assistant. I can answer questions about this role, check if you qualify, and help you schedule your next step. How can I help you today?",
  zh: "您好！👋 我是 Avelthorne People Group 的招聘助手。我可以解答您关于职位的问题，确认资格条件，并协助您安排下一步。请问我可以怎么帮助您？",
};

const PLACEHOLDER: Record<string, string> = {
  en: "Ask me about the role…",
  zh: "向我询问职位信息…",
};

const SEND_LABEL: Record<string, string> = {
  en: "Send",
  zh: "发送",
};

// Floating recruitment chatbot widget — appears on careers/job pages.
// Renders as a button bottom-right; expands to a chat panel on click.
export function ChatWidget({ job, lang = "en" }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME[lang] ?? WELCOME.en },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to latest message whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setStreaming(true);

    // Placeholder assistant message that will be filled by the stream
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          job,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        // Update the last message in place as tokens arrive
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: accumulated,
          };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content:
            lang === "zh"
              ? "抱歉，出现了错误，请稍后再试。"
              : "Sorry, something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  // Auto-resize the textarea as the user types
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  // Allow Enter to submit, Shift+Enter for newline
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(e as unknown as FormEvent);
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Open hiring assistant"}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
        style={{ backgroundColor: "#1f7a4d", color: "#edf3ec" }}
      >
        {open ? <X size={22} /> : <MessageCircle size={24} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{ height: "520px", border: "1px solid #1f7a4d22" }}
          role="dialog"
          aria-label="Hiring assistant"
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center gap-3 px-4 py-3"
            style={{ backgroundColor: "#0f3a28" }}
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
              style={{ backgroundColor: "#1f7a4d", color: "#edf3ec" }}
              aria-hidden="true"
            >
              AI
            </div>
            <div>
              <p
                className="text-sm font-semibold leading-tight"
                style={{ color: "#edf3ec" }}
              >
                Hiring Assistant
              </p>
              <p className="text-xs" style={{ color: "#c8662b" }}>
                Avelthorne People Group
              </p>
            </div>
            <button
              type="button"
              className="ml-auto rounded p-1 transition-opacity hover:opacity-70"
              style={{ color: "#edf3ec" }}
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
            style={{ backgroundColor: "#edf3ec" }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={
                    msg.role === "user"
                      ? { backgroundColor: "#1f7a4d", color: "#edf3ec", borderBottomRightRadius: 4 }
                      : { backgroundColor: "#ffffff", color: "#13261c", border: "1px solid #cfdfd2", borderBottomLeftRadius: 4 }
                  }
                >
                  {msg.content || (
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: "#1f7a4d" }}
                    >
                      <Loader2 size={12} className="animate-spin" />
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <form
            onSubmit={send}
            className="flex shrink-0 items-end gap-2 border-t px-3 py-2"
            style={{ backgroundColor: "#ffffff", borderColor: "#cfdfd2" }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              placeholder={PLACEHOLDER[lang] ?? PLACEHOLDER.en}
              className="flex-1 resize-none rounded-xl border-0 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-gray-400 disabled:opacity-50"
              style={{ color: "#13261c", maxHeight: 120 }}
              aria-label="Message"
            />
            <button
              type="submit"
              disabled={!input.trim() || streaming}
              className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40"
              style={{ backgroundColor: "#1f7a4d", color: "#edf3ec" }}
              aria-label={SEND_LABEL[lang] ?? "Send"}
            >
              {streaming ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
