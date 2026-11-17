import test from "node:test";
import assert from "node:assert/strict";
import { isDocumentNavigation } from "../../../src/server/auth/language.ts";

test("document visits persist language but RSC/data/prefetch requests do not", () => {
  const request = (headers, method = "GET") => ({
    method,
    headers: new Headers(headers),
  });
  assert.equal(
    isDocumentNavigation(
      request({ "sec-fetch-dest": "document", accept: "text/html" }),
    ),
    true,
  );
  assert.equal(
    isDocumentNavigation(request({ "sec-fetch-mode": "navigate" })),
    true,
  );
  assert.equal(
    isDocumentNavigation(
      request({ accept: "text/html,application/xhtml+xml" }),
    ),
    true,
  );
  assert.equal(
    isDocumentNavigation(
      request({ rsc: "1", "next-router-prefetch": "1", accept: "*/*" }),
    ),
    false,
  );
  assert.equal(
    isDocumentNavigation(request({ accept: "text/html", purpose: "prefetch" })),
    false,
  );
  assert.equal(
    isDocumentNavigation(
      request({ accept: "text/html", "sec-purpose": "prefetch;prerender" }),
    ),
    false,
  );
  assert.equal(
    isDocumentNavigation(request({ accept: "text/html" }, "POST")),
    false,
  );
  assert.equal(isDocumentNavigation(request({ accept: "*/*" })), false);
});
