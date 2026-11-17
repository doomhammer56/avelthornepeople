"use client";

import { useEffect, useId, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

declare global {
  interface Window {
    turnstile?: {
      render: (node: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}
type Intent = "login" | "recover" | "password" | "confirm" | "logout";
const text = {
  en: {
    email: "Email",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    newPassword: "New password (at least 12 characters)",
    repeat: "Confirm password",
    login: "Sign in",
    recover: "Send recovery email",
    passwordSave: "Save password",
    confirm: "Continue with this email link",
    logout: "Sign out",
    busy: "Please wait…",
    error:
      "We could not complete your request. Check your details or try again shortly.",
    limited: "Too many requests. Please try again shortly.",
    locked:
      "Sign-in is temporarily locked. Try again after the countdown, or use password recovery.",
    inProgress:
      "A sign-in is already in progress. Please wait before retrying.",
    invalid: "Sign-in failed. Check your email and password.",
    unavailable:
      "Authentication is temporarily unavailable. Please try again shortly.",
    retry: "You can retry in",
    sent: "If the address is eligible, you will receive a recovery email.",
    forgot: "Forgot your password?",
    back: "Back to sign in",
    mismatch: "The passwords must match.",
    captcha: "Complete the security check to continue.",
    captchaFailed:
      "The security check could not load. Reload this page to try again.",
    resend: "Send another recovery email",
    linkInvalid:
      "This email link has expired or has already been used. Request a new link to continue.",
    requestLink: "Request a new recovery link",
    weak: "This password does not meet the security requirements. Choose a stronger password.",
    reused: "Choose a password different from your current password.",
    resetRequired:
      "We could not finish this password reset. Request a new link to continue.",
  },
  zh: {
    email: "邮箱",
    password: "密码",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    newPassword: "新密码（至少 12 个字符）",
    repeat: "确认密码",
    login: "登录",
    recover: "发送重置邮件",
    passwordSave: "保存密码",
    confirm: "继续验证此邮件链接",
    logout: "退出登录",
    busy: "请稍候…",
    error: "无法完成请求，请检查信息或稍后重试。",
    limited: "请求过多，请稍后重试。",
    locked: "登录已暂时锁定。请在倒计时结束后重试，或使用密码找回。",
    inProgress: "登录正在处理中，请稍后重试。",
    invalid: "登录失败，请检查邮箱和密码。",
    unavailable: "身份验证暂时不可用，请稍后重试。",
    retry: "可重试时间：",
    sent: "如果该邮箱符合条件，您将收到密码重置邮件。",
    forgot: "忘记密码？",
    back: "返回登录",
    mismatch: "两次输入的密码必须一致。",
    captcha: "请完成安全验证。",
    captchaFailed: "安全验证加载失败，请刷新页面重试。",
    resend: "再次发送重置邮件",
    linkInvalid: "此邮件链接已过期或已使用，请获取新链接后继续。",
    requestLink: "获取新的密码重置链接",
    weak: "此密码不符合安全要求，请选择更强的密码。",
    reused: "请选择与当前密码不同的新密码。",
    resetRequired: "无法完成密码重置，请获取新链接后继续。",
  },
};

function PasswordVisibilityButton({
  visible,
  label,
  onToggle,
}: {
  visible: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={visible}
      onClick={onToggle}
      className="absolute inset-y-px right-px flex w-12 items-center justify-center rounded-r-[9px] border-l border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {visible ? <path d="m3 3 18 18" /> : null}
      </svg>
    </button>
  );
}

export function AuthForm({
  intent,
  lang = "en",
  siteKey = "",
  next = "/admin",
}: {
  intent: Intent;
  lang?: "en" | "zh";
  siteKey?: string;
  next?: string;
}) {
  const copy = text[lang];
  const passwordId = useId();
  const repeatId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const captcha = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const confirmation = useRef<
    { type: "invite" | "recovery"; token_hash: string } | undefined
  >(undefined);
  const challenge = intent === "login" || intent === "recover";
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => {
    if (intent === "confirm") {
      // Read the one-time credential from the email URL locally, rather than
      // copying it into serialized Server Component props.
      const query = new URLSearchParams(window.location.search);
      const token = query.get("token_hash"),
        type = query.get("type");
      if (
        token &&
        /^[a-z0-9_-]{32,256}$/i.test(token) &&
        (type === "invite" || type === "recovery")
      )
        confirmation.current = { type, token_hash: token };
      window.history.replaceState(null, "", `/auth/confirm?lang=${lang}`);
    }
  }, [intent, lang]);
  useEffect(() => {
    if (
      !challenge ||
      !loaded ||
      !captcha.current ||
      !window.turnstile ||
      !siteKey
    )
      return;
    // Use the compact widget only when the form cannot fit its 300px minimum.
    // Recreate on size-mode changes, clearing the previous widget's token.
    let currentSize: "compact" | "flexible" | undefined;
    const node = captcha.current;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.contentRect.width < 300 ? "compact" : "flexible";
      if (size === currentSize || !window.turnstile) return;
      currentSize = size;
      if (widget.current) window.turnstile.remove(widget.current);
      setCaptchaToken("");
      widget.current = window.turnstile.render(node, {
        sitekey: siteKey,
        size,
        theme: "light",
        language: lang === "zh" ? "zh-CN" : "en",
        callback: (token: string) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": () => {
          setCaptchaToken("");
          setMessage(copy.captchaFailed);
        },
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [challenge, loaded, siteKey, lang, copy.captchaFailed]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy || remaining > 0) return;
    if (intent === "confirm" && !confirmation.current) {
      setMessage(copy.linkInvalid);
      setInvalidLink(true);
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    if (intent === "password" && data.get("password") !== data.get("repeat")) {
      setMessage(copy.mismatch);
      return;
    }
    if (challenge && !captchaToken) {
      setMessage(copy.captcha);
      return;
    }
    setBusy(true);
    submitting.current = true;
    setMessage("");
    try {
      const action = intent === "password" ? "password" : intent;
      const response = await fetch(`/api/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          ...Object.fromEntries(data),
          captchaToken,
          next,
          lang,
          ...confirmation.current,
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        if (
          result.code === "email_link_invalid" ||
          result.code === "password_reset_required"
        ) {
          setInvalidLink(true);
          setMessage(
            result.code === "email_link_invalid"
              ? copy.linkInvalid
              : copy.resetRequired,
          );
          confirmation.current = undefined;
          return;
        }
        setMessage(
          result.code === "password_weak"
            ? copy.weak
            : result.code === "password_reused"
              ? copy.reused
              : result.code === "login_locked"
                ? copy.locked
                : result.code === "login_busy"
                  ? copy.inProgress
                  : result.code === "captcha_failed"
                    ? copy.captcha
                    : response.status === 429
                      ? copy.limited
                      : response.status === 503
                        ? copy.unavailable
                        : intent === "login" && response.status === 401
                          ? copy.invalid
                          : copy.error,
        );
        const seconds = Number(result.retryAfterSeconds);
        if (
          response.status === 429 &&
          Number.isInteger(seconds) &&
          seconds > 0 &&
          seconds <= 900
        ) {
          setRemaining(seconds);
          setRetryUntil(Date.now() + seconds * 1000);
        }
        return;
      }
      const result = await response.json();
      if (result.sent) {
        setSent(true);
        setMessage(copy.sent);
        setRemaining(60);
        setRetryUntil(Date.now() + 60_000);
        return;
      }
      form.reset();
      // Full navigation discards all in-memory private query/component state.
      window.location.replace(result.next || "/admin");
    } catch {
      setMessage(copy.error);
    } finally {
      setBusy(false);
      submitting.current = false;
      setCaptchaToken("");
      if (widget.current) window.turnstile?.reset(widget.current);
    }
  }
  const label =
    intent === "login"
      ? copy.login
      : intent === "recover"
        ? sent
          ? copy.resend
          : copy.recover
        : intent === "password"
          ? copy.passwordSave
          : intent === "confirm"
            ? copy.confirm
            : copy.logout;
  if (invalidLink)
    return (
      <div className="space-y-5">
        <p role="alert">{message}</p>
        <Link
          prefetch={false}
          href={`/admin/forgot-password?lang=${lang}`}
          className="block underline"
        >
          {copy.requestLink}
        </Link>
        <Link
          prefetch={false}
          href={`/admin/login?lang=${lang}`}
          className="block text-sm underline"
        >
          {copy.back}
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
      {challenge ? (
        <>
          <label className="grid gap-2 text-sm font-medium">
            <span>
              {copy.email}
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </span>
            <Input
              className="h-12 rounded-[6px] bg-secondary/40 px-3 text-base shadow-xs md:text-base"
              name="email"
              type="email"
              autoComplete={intent === "login" ? "username" : "email"}
              maxLength={254}
              required
            />
          </label>
        </>
      ) : null}
      {intent === "login" || intent === "password" ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <label htmlFor={passwordId}>
              {intent === "password" ? copy.newPassword : copy.password}
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </label>
            {intent === "login" ? (
              <Link
                prefetch={false}
                href={`/admin/forgot-password?lang=${lang}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {copy.forgot}
              </Link>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id={passwordId}
              className="h-12 rounded-[6px] bg-secondary/40 pr-14 pl-3 text-base shadow-xs md:text-base"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={
                intent === "password" ? "new-password" : "current-password"
              }
              minLength={intent === "password" ? 12 : 8}
              maxLength={256}
              required
            />
            <PasswordVisibilityButton
              visible={showPassword}
              label={showPassword ? copy.hidePassword : copy.showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </div>
        </div>
      ) : null}
      {intent === "password" ? (
        <div className="grid gap-2">
          <label htmlFor={repeatId} className="text-sm font-medium">
            {copy.repeat}
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          </label>
          <div className="relative">
            <Input
              id={repeatId}
              className="h-12 rounded-[10px] bg-secondary/40 pr-14 pl-3 text-base shadow-xs md:text-base"
              name="repeat"
              type={showRepeat ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
            <PasswordVisibilityButton
              visible={showRepeat}
              label={showRepeat ? copy.hidePassword : copy.showPassword}
              onToggle={() => setShowRepeat((value) => !value)}
            />
          </div>
        </div>
      ) : null}
      {challenge ? (
        <>
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onReady={() => setLoaded(true)}
            onError={() => setMessage(copy.captchaFailed)}
          />
          <div
            ref={captcha}
            aria-label={copy.captcha}
          />
          {!siteKey ? (
            <p role="alert" className="text-sm">
              {copy.captchaFailed}
            </p>
          ) : null}
        </>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className="rounded-sm bg-muted p-3 text-sm empty:hidden"
      >
        {message}
      </p>
      {remaining > 0 ? (
        <p className="text-sm" aria-live="off">
          {copy.retry} {Math.floor(remaining / 60)}:
          {String(remaining % 60).padStart(2, "0")}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={
          busy || remaining > 0 || (challenge && (!siteKey || !captchaToken))
        }
        className="h-12 w-full rounded-[6px] text-base font-semibold"
        size="lg"
      >
        {busy ? copy.busy : label}
      </Button>
      {intent !== "login" && intent !== "logout" ? (
        <Link
          prefetch={false}
          href={`/admin/login?lang=${lang}`}
          className="block text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {copy.back}
        </Link>
      ) : null}
    </form>
  );
}
