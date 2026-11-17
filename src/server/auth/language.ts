// Flight/prefetch headers are stripped before Proxy in this Next.js version.
// Only document navigations persist language implicitly. Client switches use POST.
export function isDocumentNavigation(request: {
  method: string;
  headers: Headers;
}) {
  return (
    request.method === "GET" &&
    !/prefetch/i.test(request.headers.get("purpose") ?? "") &&
    !/prefetch/i.test(request.headers.get("sec-purpose") ?? "") &&
    (request.headers.get("sec-fetch-dest") === "document" ||
      request.headers.get("sec-fetch-mode") === "navigate" ||
      (request.headers.get("accept") ?? "").includes("text/html"))
  );
}
