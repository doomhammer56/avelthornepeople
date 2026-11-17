"use client";

import { PageError } from "@/components/PageError";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <PageError retry={retry} />;
}
