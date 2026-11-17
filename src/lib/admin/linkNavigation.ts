// Only these cache-owned screens can handle query changes without another RSC render.
export function isAdminQueryNavigation(
  href: string,
  current: string,
  documentLanguage?: "en" | "zh",
) {
  const target = new URL(href, current),
    source = new URL(current);
  return (
    target.origin === source.origin &&
    target.pathname === source.pathname &&
    ["/admin", "/admin/jobs"].includes(target.pathname) &&
    target.hash === source.hash &&
    (target.searchParams.get("lang") ?? documentLanguage) ===
      (source.searchParams.get("lang") ?? documentLanguage)
  );
}
