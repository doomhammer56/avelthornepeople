"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ContactContent } from "@/lib/contactContent";
import type { Locale } from "@/lib/homeContent";
import {
  createContactSchema,
  sendContactMessage,
  type ContactValues,
} from "@/lib/contactForm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type Props = {
  locale: Locale;
  content: ContactContent;
  endpoint: string | null;
};

const subscribe = () => () => {};

const fieldClassName = "border-foreground/15 bg-secondary/50";

export function ContactForm({ locale, content: t, endpoint }: Props) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(createContactSchema(t.validation)),
    defaultValues: { name: "", company: "", email: "", message: "" },
  });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (sent) successHeading.current?.focus();
  }, [sent]);

  const submit = async (values: ContactValues) => {
    if (!endpoint || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setFailed(false);
    try {
      await sendContactMessage(
        endpoint,
        values,
        locale,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      );
      if (!controller.signal.aborted) {
        reset();
        setSent(true);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      request.current = null;
    }
  };

  const cardClass =
    "min-w-0 rounded-[4px_28px_4px_4px] bg-card p-6 sm:p-8 lg:p-10";

  if (sent) {
    return (
      <div className={cn(cardClass, "flex flex-col gap-3")} role="status">
        <h2
          ref={successHeading}
          tabIndex={-1}
          className="m-0 font-serif text-xl font-semibold text-brand-navy sm:text-2xl"
        >
          {t.successTitle}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          {t.successDescription}
        </p>
      </div>
    );
  }

  return (
    <form
      className={cardClass}
      method="post"
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      aria-label={t.title}
      aria-busy={isSubmitting}
    >
      <fieldset
        disabled={!hydrated || isSubmitting}
        className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        {(
          [
            {
              key: "name",
              label: t.name,
              type: "text",
              complete: "name",
              max: 120,
              required: true,
            },
            {
              key: "company",
              label: t.company,
              type: "text",
              complete: "organization",
              max: 160,
              required: false,
            },
            {
              key: "email",
              label: t.email,
              type: "email",
              complete: "email",
              max: 254,
              required: true,
            },
          ] as const
        ).map((field) => (
          <div className="flex flex-col gap-2" key={field.key}>
            <Label htmlFor={`contact-${field.key}`}>
              {field.label}
              {field.required ? (
                <span className="text-brand-teal" aria-hidden="true">
                  {" "}
                  *
                </span>
              ) : null}
            </Label>
            <Input
              id={`contact-${field.key}`}
              type={field.type}
              autoComplete={field.complete}
              maxLength={field.max}
              required={field.required}
              className={fieldClassName}
              aria-invalid={Boolean(errors[field.key])}
              aria-describedby={
                errors[field.key] ? `contact-${field.key}-error` : undefined
              }
              {...register(field.key)}
            />
            {errors[field.key] ? (
              <p
                className="m-0 text-sm font-medium text-destructive"
                id={`contact-${field.key}-error`}
                role="alert"
              >
                {errors[field.key]?.message}
              </p>
            ) : null}
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-message">
            {t.message}
            <span className="text-brand-teal" aria-hidden="true">
              {" "}
              *
            </span>
          </Label>
          <Textarea
            id="contact-message"
            rows={5}
            maxLength={5000}
            required
            className={cn(fieldClassName, "min-h-[140px]")}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={
              errors.message ? "contact-message-error" : undefined
            }
            {...register("message")}
          />
          {errors.message ? (
            <p
              className="m-0 text-sm font-medium text-destructive"
              id="contact-message-error"
              role="alert"
            >
              {errors.message.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          className="mt-1 w-full rounded-md"
          disabled={!endpoint || !hydrated || isSubmitting}
        >
          {isSubmitting ? t.sending : t.send}
        </Button>
      </fieldset>

      {failed ? (
        <p className="mt-4 text-sm font-medium text-destructive" role="alert">
          {t.failed}
        </p>
      ) : null}
      <noscript>
        <p className="mt-4 text-sm text-muted-foreground">{t.noScript}</p>
      </noscript>
    </form>
  );
}
