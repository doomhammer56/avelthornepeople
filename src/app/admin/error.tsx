"use client";

import { PageError } from "@/components/PageError";

export default function AdminError({ retry }: { retry: () => void }) {
  return <PageError retry={retry} />;
}
