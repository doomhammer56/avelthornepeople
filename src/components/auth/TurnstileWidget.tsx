"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

// Cloudflare Turnstile challenge for forms inside the console. Tokens are
// single-use, so bump `resetSignal` after every submit to obtain a fresh one.
export function TurnstileWidget({
  siteKey,
  lang,
  label,
  resetSignal,
  onToken,
  onError,
}: {
  siteKey: string;
  lang: "en" | "zh";
  label: string;
  resetSignal: number;
  onToken: (token: string) => void;
  onError: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  // Callbacks change identity every render; keep the widget bound to the latest.
  const callbacks = useRef({ onToken, onError });
  useEffect(() => {
    callbacks.current = { onToken, onError };
  });
  useEffect(() => {
    if (!loaded || !siteKey || !node.current || !window.turnstile) return;
    widget.current = window.turnstile.render(node.current, {
      sitekey: siteKey,
      theme: "auto",
      language: lang === "zh" ? "zh-CN" : "en",
      callback: (token: string) => callbacks.current.onToken(token),
      "expired-callback": () => callbacks.current.onToken(""),
      "error-callback": () => {
        callbacks.current.onToken("");
        callbacks.current.onError();
      },
    });
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [loaded, siteKey, lang]);
  useEffect(() => {
    if (resetSignal && widget.current) window.turnstile?.reset(widget.current);
  }, [resetSignal]);
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
        onError={onError}
      />
      <div ref={node} aria-label={label} />
    </>
  );
}
