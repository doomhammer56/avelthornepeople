"use client";

import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import Script from "next/script";
import { Controller } from "react-hook-form";
import { Loader2Icon, XIcon } from "lucide-react";
import { cn } from "cn";
import { publicSiteClass } from "@/lib/publicSite";

declare global {
  interface Window {
    turnstile?: {
      render: (node: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}
import { parsePhoneNumber } from "@/lib/phoneNumber";
import {
  getApplicationPhoneCountryOptions,
  isApplicationPhoneCountry,
} from "@/lib/applicationPhoneCountries";
import {
  ApplicationSubmissionError,
  applicationIssueMessage,
  type ApplicationFailureCode,
} from "@/lib/applicationFeedback";
import { useApplicationForm } from "@/lib/useApplicationForm";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetClose,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApplicationContent } from "@/lib/applicationContent";
import type { Locale } from "@/lib/homeContent";
import {
  submitApplication,
  type ApplicationEndpoints,
  type ApplicationReceipt,
  type ApplicationValues,
} from "@/lib/applicationForm";

const fieldSurfaceClass =
  "border-foreground/15 bg-secondary/50 sm:text-[15px] md:text-sm";

const PHONE_COUNTRY_NONE = "__none__";

type Props = {
  locale: Locale;
  content: ApplicationContent;
  jobId: string;
  jobTitle: string;
  applyLabel: string;
  endpoints: ApplicationEndpoints | null;
  /** Cloudflare Turnstile site key (public). Empty skips the widget; server still verifies when configured. */
  turnstileSiteKey?: string;
};
const subscribe = () => () => {};

// Keep candidate input in the drawer's memory and delegate modal accessibility to Sheet.
// Draft persists while the drawer is closed; it resets after a successful send or job change.
export function ApplicationDrawer({
  locale,
  content: t,
  jobId,
  jobTitle,
  applyLabel,
  endpoints,
  turnstileSiteKey = "",
}: Props) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<ApplicationReceipt | null>(null);
  const [failure, setFailure] = useState<ApplicationFailureCode | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCaptchaError, setConfirmCaptchaError] = useState(false);
  const [captchaRequiredFlash, setCaptchaRequiredFlash] = useState(false);
  const [turnstileMountReady, setTurnstileMountReady] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const pendingValues = useRef<ApplicationValues | null>(null);
  const request = useRef<AbortController | null>(null);
  const attemptKey = useRef<string | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const turnstileHost = useRef<HTMLDivElement | null>(null);
  const turnstileWidget = useRef<string | undefined>(undefined);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    trigger,
    getValues,
    watch,
    resumeField,
    formState: { errors, isSubmitting },
  } = useApplicationForm(t.validation);
  const resume = resumeField.value;
  const phoneCountryValue = watch("phoneCountry");
  const clearCorrectableFailure = () =>
    setFailure((current) => (current === "closed" ? current : null));
  const phoneCountryOptions = useMemo(
    () => getApplicationPhoneCountryOptions(locale),
    [locale],
  );

  // Drop a legacy or pasted region code that is outside our allowlist.
  useEffect(() => {
    if (phoneCountryValue && !isApplicationPhoneCountry(phoneCountryValue)) {
      setValue("phoneCountry", "");
    }
  }, [phoneCountryValue, setValue]);

  // Release browser work when the route or role changes underneath an open drawer.
  // A backend refresh must never carry one role's candidate state into another role.
  useEffect(() => () => request.current?.abort(), []);
  // Announce a confirmed receipt by focusing its visible heading.
  // Keyboard and screen-reader visitors should not remain focused on removed form controls.
  useEffect(() => {
    if (receipt) successHeading.current?.focus();
  }, [receipt]);

  // New vacancy: discard any in-progress draft from another role.
  // React state is reset while rendering (the supported way to reset state when a
  // prop changes); refs, the form and the Turnstile widget are reset in the effect.
  const [draftJobId, setDraftJobId] = useState(jobId);
  if (draftJobId !== jobId) {
    setDraftJobId(jobId);
    setReceipt(null);
    setFailure(null);
    setConfirmOpen(false);
    setConfirmSubmitting(false);
    setCaptchaToken("");
  }
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    attemptKey.current = null;
    reset();
    if (fileInput.current) fileInput.current.value = "";
    pendingValues.current = null;
    if (turnstileWidget.current && window.turnstile) {
      window.turnstile.reset(turnstileWidget.current);
      turnstileWidget.current = undefined;
    }
  }, [jobId, reset]);

  // Dialog content mounts after open; defer Turnstile render so the host element exists.
  // The ready flag is cleared in cleanup, so it is false whenever the dialog is closed.
  useEffect(() => {
    if (!confirmOpen || !turnstileSiteKey) return;
    let cancelled = false;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (!cancelled) setTurnstileMountReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      setTurnstileMountReady(false);
    };
  }, [confirmOpen, turnstileSiteKey]);

  useEffect(() => {
    if (
      !confirmOpen ||
      !turnstileMountReady ||
      !turnstileLoaded ||
      !turnstileSiteKey ||
      !turnstileHost.current ||
      !window.turnstile
    )
      return;
    const node = turnstileHost.current;
    if (turnstileWidget.current) window.turnstile.remove(turnstileWidget.current);
    setCaptchaToken("");
    setConfirmCaptchaError(false);
    turnstileWidget.current = window.turnstile.render(node, {
      sitekey: turnstileSiteKey,
      size: "flexible",
      theme: "light",
      language: locale === "zh" ? "zh-CN" : "en",
      callback: (token: string) => {
        setCaptchaToken(token);
        setCaptchaRequiredFlash(false);
        setConfirmCaptchaError(false);
      },
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => {
        setCaptchaToken("");
        setConfirmCaptchaError(true);
      },
    });
    return () => {
      if (turnstileWidget.current && window.turnstile) {
        window.turnstile.remove(turnstileWidget.current);
        turnstileWidget.current = undefined;
      }
    };
  }, [confirmOpen, turnstileMountReady, turnstileLoaded, turnstileSiteKey, locale]);

  const changeOpen = (next: boolean) => {
    if (!next) {
      request.current?.abort();
      request.current = null;
      setConfirmOpen(false);
      setConfirmSubmitting(false);
    }
    setOpen(next);
  };

  // Route both picker and drop events through the same single-file validation.
  // Invalid selections are visible immediately and cannot bypass the submit schema.
  const chooseFiles = (files: FileList | null) => {
    if (isSubmitting) return;
    if (files && files.length > 1) {
      setValue("resume", null);
      setError("resume", { message: t.validation.multiple });
      return;
    }
    setValue("resume", files?.[0] ?? null, {
      shouldValidate: true,
      shouldDirty: true,
    });
    attemptKey.current = null;
    clearCorrectableFailure();
  };
  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    chooseFiles(event.dataTransfer.files);
  };

  // Use one idempotency key across retries of the same in-memory form attempt.
  // A lost acknowledgement must not create another application when the visitor retries.
  const runSubmit = async (values: ApplicationValues, token: string) => {
    if (!endpoints || request.current || failure === "closed") return;
    const controller = new AbortController();
    request.current = controller;
    attemptKey.current ??= crypto.randomUUID();
    setFailure(null);
    setConfirmSubmitting(true);
    try {
      const result = await submitApplication(
        endpoints,
        jobId,
        locale,
        values,
        token,
        attemptKey.current,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      );
      if (!controller.signal.aborted) {
        reset();
        if (fileInput.current) fileInput.current.value = "";
        setReceipt(result);
        pendingValues.current = null;
        setCaptchaToken("");
        if (turnstileWidget.current && window.turnstile) {
          window.turnstile.reset(turnstileWidget.current);
        }
        setConfirmOpen(false);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApplicationSubmissionError) {
          error.issues.forEach((issue, index) =>
            setError(
              issue.field,
              {
                type: "server",
                message: applicationIssueMessage(issue, t),
              },
              { shouldFocus: index === 0 },
            ),
          );
          setFailure(error.code);
          setRetryAfter(error.retryAfterSeconds);
          if (error.code === "captcha" && turnstileWidget.current && window.turnstile) {
            window.turnstile.reset(turnstileWidget.current);
            setCaptchaToken("");
          }
        } else setFailure("unconfirmed");
        setConfirmOpen(false);
      }
    } finally {
      if (request.current === controller) request.current = null;
      setConfirmSubmitting(false);
    }
  };

  return (
    <>
    {turnstileSiteKey ? (
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="lazyOnload"
        onLoad={() => setTurnstileLoaded(true)}
        onError={() => setConfirmCaptchaError(true)}
      />
    ) : null}
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger
        disabled={!hydrated}
        render={
          <Button
            type="button"
            variant="default"
            className="h-auto min-h-11 w-full px-6 py-3 text-sm disabled:pointer-events-none"
          />
        }
      >
        {applyLabel}
      </SheetTrigger>
      <noscript>
        <p>{t.noScript}</p>
      </noscript>
      <SheetContent
        className={cn(
          publicSiteClass,
          "w-full max-w-[min(100vw,600px)] gap-0 overflow-y-auto rounded-none border-0 bg-card p-0 shadow-[0_8px_32px_rgb(0_0_0/16%),0_2px_4px_rgb(0_0_0/8%)]",
          "data-[side=right]:w-full data-[side=right]:max-w-[min(100vw,600px)] sm:data-[side=right]:max-w-[600px]",
          "h-dvh motion-reduce:transition-none",
        )}
        overlayClassName="bg-[rgb(51_54_61/35%)] backdrop-blur-none motion-reduce:transition-none"
        showCloseButton={false}
        aria-modal="true"
        initialFocus={() => document.getElementById("apply-name")}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-site-header px-7 pt-8 pb-8 text-[var(--accent-foreground)] [--muted-foreground:var(--accent-foreground)] [--site-ink-secondary:var(--accent-foreground)]">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="m-0 text-[13px] leading-none text-muted-foreground">
              {t.title}
            </p>
            <SheetTitle className="m-0 font-heading text-[26px] font-semibold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere]">
              {jobTitle}
            </SheetTitle>
          </div>
          <SheetClose
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0 rounded-full border-foreground/20"
                aria-label={t.close}
              />
            }
          >
            <XIcon className="size-4" />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">{t.resumeHint}</SheetDescription>
        {receipt ? (
          <div
            className="flex flex-col gap-3 px-6 py-8 sm:px-7"
            role="status"
          >
            <h2
              ref={successHeading}
              tabIndex={-1}
              className="m-0 text-[22px] leading-snug text-foreground"
            >
              {t.successTitle}
            </h2>
            <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
              {receipt.status === "duplicate"
                ? t.duplicate
                : receipt.confirmationEmailSent
                  ? t.successDescription
                  : t.acceptedDescription}
            </p>
          </div>
        ) : (
          <form
            className="px-7 py-7"
            method="post"
            noValidate
            aria-busy={isSubmitting}
            onSubmit={(event) => {
              void handleSubmit((values) => {
                pendingValues.current = values;
                setConfirmCaptchaError(false);
                setCaptchaRequiredFlash(false);
                setConfirmOpen(true);
              })(event);
            }}
          >
            <fieldset
              disabled={isSubmitting}
              className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
            >
              {/* Connect every required control to its own translated validation message.
              Autocomplete remains native while values never enter URLs or browser storage. */}
              {(
                [
                  {
                    key: "name",
                    label: t.name,
                    type: "text",
                    complete: "name",
                    max: 120,
                  },
                  {
                    key: "email",
                    label: t.email,
                    type: "email",
                    complete: "email",
                    max: 254,
                  },
                  {
                    key: "phone",
                    label: t.phone,
                    type: "tel",
                    complete: "tel",
                    max: 40,
                  },
                ] as const
              ).map((field) => (
                <div className="flex flex-col gap-2" key={field.key}>
                  <Label htmlFor={`apply-${field.key}`}>
                    {field.label}{" "}
                    <span className="text-brand-teal" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <div
                    className={
                      field.key === "phone"
                        ? "grid min-w-0 grid-cols-1 gap-2 min-[421px]:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)]"
                        : undefined
                    }
                  >
                    {field.key === "phone" && (
                      <div className="min-w-0 max-w-full min-[421px]:max-w-[12rem]">
                        <Label className="sr-only" htmlFor="apply-phone-country">
                          {t.phoneCountry}
                        </Label>
                        <Controller
                          name="phoneCountry"
                          control={control}
                          render={({ field: countryField }) => {
                            const selected = phoneCountryOptions.find(
                              (o) => o.country === countryField.value,
                            );
                            return (
                              <Select
                                value={
                                  countryField.value
                                    ? countryField.value
                                    : PHONE_COUNTRY_NONE
                                }
                                onValueChange={(next) => {
                                  countryField.onChange(
                                    next === PHONE_COUNTRY_NONE ? "" : next,
                                  );
                                  attemptKey.current = null;
                                  clearCorrectableFailure();
                                  if (getValues("phone").trim())
                                    void trigger("phone");
                                }}
                                disabled={isSubmitting}
                              >
                                <SelectTrigger
                                  id="apply-phone-country"
                                  size="default"
                                  className={cn(
                                    "flex h-11 w-full max-w-full min-w-0 items-center justify-between rounded-lg border border-foreground/20 bg-white pl-3 pr-2.5 text-left text-sm font-normal text-foreground shadow-none",
                                    "max-sm:text-base data-[size=default]:h-11 data-[size=default]:min-h-11",
                                    "[&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:max-w-full [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-foreground [&_[data-slot=select-value]]:text-left",
                                    "[&_svg]:shrink-0 [&_svg]:text-muted-foreground/80",
                                    "focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20",
                                    fieldSurfaceClass,
                                  )}
                                  aria-label={t.phoneCountry}
                                >
                                  <SelectValue placeholder={t.chooseCountry}>
                                    {selected
                                      ? `${selected.name} (+${selected.code})`
                                      : t.chooseCountry}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent
                                  align="start"
                                  alignItemWithTrigger={false}
                                  className={cn(
                                    "min-w-[var(--anchor-width)] w-max max-w-[min(92vw,24rem)] text-sm max-sm:text-base",
                                  )}
                                >
                                  <SelectItem
                                    value={PHONE_COUNTRY_NONE}
                                    className="py-2.5 text-sm max-sm:text-base"
                                  >
                                    {t.chooseCountry}
                                  </SelectItem>
                                  {phoneCountryOptions.map((opt) => (
                                    <SelectItem
                                      key={opt.country}
                                      value={opt.country}
                                      className="py-2.5 text-sm max-sm:text-base"
                                    >
                                      {opt.name} (+{opt.code})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          }}
                        />
                      </div>
                    )}
                    <Input
                      id={`apply-${field.key}`}
                      type={field.type}
                      autoComplete={field.complete}
                      inputMode={field.key === "phone" ? "tel" : undefined}
                      placeholder={
                        field.key === "phone" ? t.phonePlaceholder : undefined
                      }
                      maxLength={field.max}
                      required
                      className={cn(
                        fieldSurfaceClass,
                        "rounded-lg",
                        field.key === "phone" && "max-sm:text-base",
                      )}
                      aria-invalid={Boolean(errors[field.key])}
                      aria-describedby={
                        errors[field.key]
                          ? `apply-${field.key}-error`
                          : undefined
                      }
                      {...register(field.key)}
                      onInput={() => {
                        attemptKey.current = null;
                        clearCorrectableFailure();
                      }}
                      onBlur={(event) => {
                        if (field.key === "phone") {
                          const phone = parsePhoneNumber(
                            event.target.value,
                            getValues("phoneCountry"),
                          );
                          if (
                            phone?.country &&
                            isApplicationPhoneCountry(phone.country)
                          ) {
                            setValue("phoneCountry", phone.country);
                            setValue("phone", phone.formatNational(), {
                              shouldValidate: true,
                            });
                          }
                        }
                        void register(field.key).onBlur(event);
                      }}
                    />
                  </div>
                  {errors[field.key] && (
                    <p
                      className="m-0 text-sm font-medium text-destructive"
                      id={`apply-${field.key}-error`}
                      role="alert"
                    >
                      {errors[field.key]?.message}
                    </p>
                  )}
                </div>
              ))}
              {/* Keep the PRD's optional letter in transient form memory like the contact fields.
                  Edits renew the attempt key, and normal close/reset clears the text. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-cover-letter">{t.coverLetter}</Label>
                <Textarea
                  id="apply-cover-letter"
                  rows={4}
                  maxLength={5000}
                  className={cn(fieldSurfaceClass, "min-h-[120px] resize-y rounded-lg max-sm:text-base")}
                  aria-invalid={Boolean(errors.coverLetter)}
                  aria-describedby={
                    errors.coverLetter ? "apply-cover-letter-error" : undefined
                  }
                  {...register("coverLetter")}
                  onInput={() => {
                    attemptKey.current = null;
                    clearCorrectableFailure();
                  }}
                />
                {errors.coverLetter && (
                  <p
                    className="m-0 text-sm font-medium text-destructive"
                    id="apply-cover-letter-error"
                    role="alert"
                  >
                    {errors.coverLetter.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span
                  id="apply-resume-label"
                  className="text-sm font-medium text-muted-foreground"
                >
                  {t.resume}{" "}
                  <span className="text-brand-teal" aria-hidden="true">
                    *
                  </span>
                </span>
                <label
                  className={cn(
                    "block cursor-pointer rounded-2xl border border-dashed border-foreground/20 bg-background px-5 py-5 text-center text-sm leading-relaxed text-muted-foreground transition-colors",
                    "hover:border-brand-teal/40 focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/20 focus-within:outline-none",
                    errors.resume && "border-destructive border-solid",
                  )}
                  htmlFor="apply-resume"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={dropFile}
                >
                  <span id="apply-resume-hint" className="text-brand-teal">
                    {t.resumeHint}
                  </span>
                  <input
                    className="sr-only"
                    id="apply-resume"
                    type="file"
                    accept=".pdf,.doc,application/pdf,application/msword"
                    aria-required="true"
                    aria-labelledby="apply-resume-label"
                    aria-invalid={Boolean(errors.resume)}
                    aria-describedby={`apply-resume-hint${errors.resume ? " apply-resume-error" : ""}`}
                    name={resumeField.name}
                    onBlur={resumeField.onBlur}
                    ref={(element) => {
                      resumeField.ref(element);
                      fileInput.current = element;
                    }}
                    onChange={(event) => chooseFiles(event.target.files)}
                  />
                </label>
                {resume && (
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[13px] leading-snug text-muted-foreground">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {resume.name}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto min-h-[44px] shrink-0 px-1 py-0 text-sm font-medium text-brand-teal"
                      onClick={() => {
                        setValue("resume", null, { shouldValidate: true });
                        if (fileInput.current) fileInput.current.value = "";
                        attemptKey.current = null;
                      }}
                    >
                      {t.remove}
                    </Button>
                  </div>
                )}
                {errors.resume && (
                  <p
                    className="m-0 text-sm font-medium text-destructive"
                    id="apply-resume-error"
                    role="alert"
                  >
                    {errors.resume.message}
                  </p>
                )}
              </div>
              <Controller
                name="consent"
                control={control}
                render={({ field: consentField }) => (
                  <div className="flex flex-col gap-2">
                    <div className="group/field-label flex min-h-11 items-start gap-2.5">
                      <Checkbox
                        id="apply-consent"
                        className="mt-1"
                        name={consentField.name}
                        checked={consentField.value}
                        required
                        aria-invalid={Boolean(errors.consent)}
                        aria-describedby={
                          errors.consent ? "apply-consent-error" : undefined
                        }
                        onCheckedChange={(checked) => {
                          consentField.onChange(
                            checked === true,
                          );
                          attemptKey.current = null;
                          clearCorrectableFailure();
                        }}
                        onBlur={consentField.onBlur}
                        inputRef={consentField.ref}
                      />
                      <Label
                        htmlFor="apply-consent"
                        className="cursor-pointer items-start text-[13px] leading-relaxed font-normal text-muted-foreground"
                      >
                        {t.consent}
                      </Label>
                    </div>
                    {errors.consent && (
                      <p
                        className="m-0 text-sm font-medium text-destructive"
                        id="apply-consent-error"
                        role="alert"
                      >
                        {errors.consent.message}
                      </p>
                    )}
                  </div>
                )}
              />
              <Button
                className="mt-0 h-[50px] w-full rounded-lg text-base font-semibold"
                type="submit"
                disabled={!endpoints || isSubmitting || failure === "closed"}
                aria-describedby={
                  !endpoints ? "apply-service-unavailable" : undefined
                }
              >
                {isSubmitting ? t.sending : t.submit}
              </Button>
            </fieldset>
            {!endpoints && (
              <p
                className="m-0 pt-4 text-sm leading-relaxed text-muted-foreground"
                id="apply-service-unavailable"
              >
                {t.unavailable}
              </p>
            )}
            {failure && (
              <p
                className="m-0 pt-4 text-sm font-medium leading-relaxed text-destructive"
                role="alert"
              >
                {failure === "closed"
                  ? t.closed
                  : failure === "rateLimited" && retryAfter
                    ? t.retryAfter.replace("{seconds}", String(retryAfter))
                    : t.errors[failure]}
              </p>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
    <Dialog
      open={confirmOpen}
      onOpenChange={(next) => {
        if (!next && confirmSubmitting) return;
        setConfirmOpen(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.submitConfirmTitle}</DialogTitle>
          <DialogDescription>{t.submitConfirmDescription}</DialogDescription>
        </DialogHeader>
        {confirmSubmitting ? (
          <div
            className="flex min-h-[3.25rem] items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2Icon className="size-5 shrink-0 animate-spin text-brand-teal" aria-hidden />
            <span>{t.sending}</span>
          </div>
        ) : (
          <>
            {turnstileSiteKey && turnstileMountReady ? (
              <div className="flex min-h-[65px] w-full justify-center">
                <div ref={turnstileHost} className="w-full min-w-0" />
              </div>
            ) : null}
            {confirmCaptchaError ? (
              <p className="m-0 text-sm text-destructive" role="alert">
                {t.captchaFailed}
              </p>
            ) : turnstileSiteKey && !captchaToken && confirmOpen ? (
              <p
                className={
                  captchaRequiredFlash
                    ? "m-0 text-sm font-medium text-foreground"
                    : "m-0 text-sm text-muted-foreground"
                }
                role={captchaRequiredFlash ? "alert" : undefined}
              >
                {t.captcha}
              </p>
            ) : null}
          </>
        )}
        <DialogFooter className="sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={confirmSubmitting}
            onClick={() => {
              setConfirmOpen(false);
            }}
          >
            {t.submitCancel}
          </Button>
          <Button
            type="button"
            disabled={confirmSubmitting || isSubmitting}
            onClick={() => {
              const values = pendingValues.current;
              if (!values || !endpoints) return;
              if (turnstileSiteKey && !captchaToken) {
                setCaptchaRequiredFlash(true);
                return;
              }
              void runSubmit(values, turnstileSiteKey ? captchaToken : "dev-skip");
            }}
          >
            {confirmSubmitting ? t.sending : t.submitConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
