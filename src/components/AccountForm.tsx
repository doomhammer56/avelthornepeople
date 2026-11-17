"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { Locale } from "@/lib/homeContent";
import { accountContent } from "@/lib/accountContent";
import {
  accountCardClass,
  accountFieldClass,
  accountNoteClass,
  siteButtonClass,
  textLinkClass,
} from "@/lib/publicSite";

const subscribe = () => () => {};

// Preview candidate account fields without sending credentials to an unimplemented service.
// Disabled server controls and a prevented POST keep values out of URLs, storage and logs.
export function AccountForm({
  locale,
  mode,
}: {
  locale: Locale;
  mode: "login" | "signup";
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const t = accountContent[locale];
  const signup = mode === "signup";
  const fields = [
    ...(signup
      ? [
          {
            key: "name",
            label: t.name,
            type: "text",
            complete: "name",
            max: 120,
          },
        ]
      : []),
    {
      key: "email",
      label: t.email,
      type: "email",
      complete: "email",
      max: 254,
    },
    {
      key: "password",
      label: t.password,
      type: "password",
      complete: signup ? "new-password" : "current-password",
      max: 256,
    },
    ...(signup
      ? [
          {
            key: "confirm",
            label: t.confirm,
            type: "password",
            complete: "new-password",
            max: 256,
          },
        ]
      : []),
  ];
  return (
    <div className={accountCardClass}>
      <form
        method="post"
        onSubmit={(event) => event.preventDefault()}
        aria-describedby="account-availability"
      >
        <fieldset disabled={!hydrated}>
          {fields.map((field) => (
            <div key={field.key} className={accountFieldClass}>
              <label htmlFor={`account-${field.key}`}>{field.label}</label>
              <input
                id={`account-${field.key}`}
                name={field.key}
                type={field.type}
                autoComplete={field.complete}
                maxLength={field.max}
                required
              />
            </div>
          ))}
          <p id="account-availability" className={accountNoteClass}>
            {t.unavailable}
          </p>
          <button className={siteButtonClass({ pill: true })} type="submit" disabled>
            {signup ? t.signup : t.login}
          </button>
        </fieldset>
      </form>
      <noscript>
        <p>{t.noScript}</p>
      </noscript>
      <p className={`${accountNoteClass} mt-6`}>
        {signup ? t.loginPrompt : t.signupPrompt}{" "}
        <Link
          className={textLinkClass}
          href={`/${locale}/${signup ? "login" : "signup"}`}
        >
          {signup ? t.login : t.signup}
        </Link>
      </p>
    </div>
  );
}
