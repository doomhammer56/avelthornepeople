"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import { FormField } from "./ui/form-field";
import { AdminPageHeader } from "./ui/page-header";
import { SectionCard } from "./ui/section-card";
import { accountContent } from "@/lib/admin/accountContent";
import { roleLabel, type AdminLang } from "@/lib/admin/nav";
import type { StaffRole } from "@/lib/auth/permissions";
import { announceAdminLogout } from "@/lib/admin/cacheEvents";
import { signInAgain } from "@/lib/admin/staffClient";

type Props = {
  lang: AdminLang;
  displayName: string;
  email: string;
  role: StaffRole;
  /** Turnstile site key; the password form cannot submit without one. */
  siteKey: string;
};

async function post(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data: unknown = await response.json().catch(() => null);
  return { response, data };
}
const codeOf = (data: unknown) =>
  data && typeof data === "object" && "code" in data
    ? String((data as { code: unknown }).code)
    : "";

function PasswordInput({
  id,
  name,
  label,
  autoComplete,
  minLength,
  value,
  onChange,
  show,
  hide,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  minLength: number;
  value: string;
  onChange: (value: string) => void;
  show: string;
  hide: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} htmlFor={id} required>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={256}
          required
          className="pr-11"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? hide : show}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </FormField>
  );
}

// Self-service profile and password screen. Name changes go to the profile
// endpoint; password changes verify the current password server-side and then
// end every session, so success always ends in a fresh sign-in.
export function AccountBoard({
  lang,
  displayName,
  email,
  role,
  siteKey,
}: Props) {
  const t = accountContent[lang];
  const router = useRouter();
  const ids = useId();
  const [refreshing, startTransition] = useTransition();

  const [name, setName] = useState(displayName);
  const [savedName, setSavedName] = useState(displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const submitting = useRef(false);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (nameBusy || trimmed === savedName) return;
    if (!trimmed || trimmed.length > 100) {
      setNameError(t.nameInvalid);
      return;
    }
    setNameBusy(true);
    setNameError("");
    try {
      const { response, data } = await post("/api/admin/account/profile", {
        displayName: trimmed,
      });
      if (response.status === 401) {
        signInAgain(lang);
        return;
      }
      if (!response.ok) {
        setNameError(response.status === 400 ? t.nameInvalid : t.nameFailed);
        return;
      }
      const saved =
        data &&
        typeof data === "object" &&
        "displayName" in data &&
        typeof data.displayName === "string"
          ? data.displayName
          : trimmed;
      setName(saved);
      setSavedName(saved);
      toast.success(t.nameSaved);
      // The sidebar reads the name from the server layout.
      startTransition(() => router.refresh());
    } catch {
      setNameError(t.nameFailed);
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || passwordBusy) return;
    if (next !== repeat) {
      setPasswordError(t.mismatch);
      return;
    }
    if (!captchaToken) {
      setPasswordError(t.captcha);
      return;
    }
    submitting.current = true;
    setPasswordBusy(true);
    setPasswordError("");
    try {
      const { response, data } = await post("/api/auth/change-password", {
        currentPassword: current,
        password: next,
        captchaToken,
        lang,
      });
      if (response.ok) {
        const destination =
          data &&
          typeof data === "object" &&
          "next" in data &&
          typeof data.next === "string" &&
          data.next.startsWith("/admin/login")
            ? data.next
            : `/admin/login?updated=1&lang=${lang}`;
        setCurrent("");
        setNext("");
        setRepeat("");
        toast.success(t.passwordSaved);
        announceAdminLogout();
        // Full navigation discards all in-memory private state.
        window.location.replace(destination);
        return;
      }
      const code = codeOf(data);
      setPasswordError(
        code === "invalid_login"
          ? t.wrongCurrent
          : code === "password_weak"
            ? t.weak
            : code === "password_reused"
              ? t.reused
              : code === "login_locked"
                ? t.locked
                : code === "login_busy"
                  ? t.inProgress
                  : code === "captcha_failed"
                    ? t.captcha
                    : code === "password_reset_required"
                      ? t.resetRequired
                      : response.status === 429
                        ? t.limited
                        : response.status === 503
                          ? t.unavailable
                          : t.failed,
      );
    } catch {
      setPasswordError(t.failed);
    } finally {
      submitting.current = false;
      setPasswordBusy(false);
      // A Turnstile token is single-use.
      setCaptchaToken("");
      setResetSignal((value) => value + 1);
    }
  }

  const nameDirty = name.trim() !== savedName;
  return (
    <>
      <AdminPageHeader title={t.title} description={t.subtitle} />
      <SectionCard
        title={t.profileTitle}
        description={t.profileHelp}
        aria-busy={nameBusy || refreshing}
      >
        <form onSubmit={saveName} className="grid max-w-xl gap-4">
          <FormField
            label={t.name}
            htmlFor={`${ids}-name`}
            hint={t.nameHelp}
            required
          >
            <Input
              id={`${ids}-name`}
              name="displayName"
              autoComplete="name"
              maxLength={100}
              required
              disabled={nameBusy}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t.email}
              htmlFor={`${ids}-email`}
              hint={t.emailHelp}
            >
              <Input id={`${ids}-email`} value={email} readOnly disabled />
            </FormField>
            <FormField label={t.role} htmlFor={`${ids}-role`}>
              <Input
                id={`${ids}-role`}
                value={roleLabel[role][lang]}
                readOnly
                disabled
              />
            </FormField>
          </div>
          {nameError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{nameError}</AlertDescription>
            </Alert>
          )}
          <div>
            <Button type="submit" disabled={nameBusy || !nameDirty}>
              {nameBusy ? t.saving : t.saveName}
            </Button>
          </div>
        </form>
      </SectionCard>
      <SectionCard title={t.passwordTitle} description={t.passwordHelp}>
        <form
          onSubmit={changePassword}
          className="grid max-w-xl gap-4"
          aria-busy={passwordBusy}
        >
          <PasswordInput
            id={`${ids}-current`}
            name="currentPassword"
            label={t.current}
            autoComplete="current-password"
            minLength={8}
            value={current}
            onChange={setCurrent}
            show={t.show}
            hide={t.hide}
          />
          <PasswordInput
            id={`${ids}-new`}
            name="newPassword"
            label={t.next}
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={setNext}
            show={t.show}
            hide={t.hide}
          />
          <PasswordInput
            id={`${ids}-repeat`}
            name="repeat"
            label={t.repeat}
            autoComplete="new-password"
            minLength={12}
            value={repeat}
            onChange={setRepeat}
            show={t.show}
            hide={t.hide}
          />
          {siteKey ? (
            <TurnstileWidget
              siteKey={siteKey}
              lang={lang}
              label={t.captcha}
              resetSignal={resetSignal}
              onToken={setCaptchaToken}
              onError={() => setPasswordError(t.captchaFailed)}
            />
          ) : (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t.captchaFailed}</AlertDescription>
            </Alert>
          )}
          {passwordError && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{passwordError}</AlertDescription>
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              disabled={passwordBusy || !siteKey || !captchaToken}
            >
              {passwordBusy ? t.changing : t.changePassword}
            </Button>
          </div>
        </form>
      </SectionCard>
    </>
  );
}
