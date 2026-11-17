import { redirect } from "next/navigation";

// Give the root URL a single localized destination.
// Explicit locales keep language switching and future pages consistent.
export default function Page() {
  redirect("/en");
}
