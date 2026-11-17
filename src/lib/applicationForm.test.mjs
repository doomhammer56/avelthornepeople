import assert from "node:assert/strict";
import test from "node:test";
import { applicationContent } from "./applicationContent.ts";
import { ApplicationSubmissionError } from "./applicationFeedback.ts";
import {
  createApplicationSchema,
  maxResumeBytes,
  submitApplication,
  ApplicationClosedError,
} from "./applicationForm.ts";

const values = {
  name: "Example Applicant",
  email: "applicant@example.test",
  phone: "+60 123456789",
  resume: new File(["example"], "example.pdf", { type: "application/pdf" }),
  consent: true,
};
const endpoints = {
  upload: "https://api.example.test/uploads",
  applications: "https://api.example.test/applications",
};
const captchaToken = "turnstile-test-token";

// Verify contact, file and consent gates using synthetic files and contact details.
// No upload request should be possible from an invalid form or an unchecked consent box.
test("application validation requires contact fields, consent and one valid PDF or DOC", () => {
  const schema = createApplicationSchema(applicationContent.en.validation);
  assert.equal(schema.safeParse(values).success, true);
  assert.equal(
    schema.parse({ ...values, coverLetter: "  Example letter  " }).coverLetter,
    "Example letter",
  );
  assert.equal(
    schema.safeParse({ ...values, coverLetter: "x".repeat(5001) }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...values,
      resume: new File(["doc"], "example.DOC", { type: "application/msword" }),
    }).success,
    true,
  );
  for (const change of [
    { name: " " },
    { email: "invalid" },
    { phone: "letters" },
    { phone: "+0164536156465" },
    { phone: "+60 1" },
    { phone: "+60123456789 ext 123" },
    { consent: false },
    { resume: null },
    { resume: new File([], "empty.pdf") },
    { resume: new File(["x"], "x".repeat(252) + ".pdf") },
    { resume: new File(["x"], "example.docx") },
    { resume: new File(["x"], "example.pdf", { type: "text/plain" }) },
    { resume: new File([new Uint8Array(maxResumeBytes + 1)], "large.pdf") },
  ])
    assert.equal(schema.safeParse({ ...values, ...change }).success, false);
  assert.equal(
    schema.safeParse({
      ...values,
      resume: new File([new Uint8Array(maxResumeBytes)], "limit.pdf"),
    }).success,
    true,
  );
});

test("country selection accepts local numbers and uses the same strict international parser", () => {
  const schema = createApplicationSchema(applicationContent.en.validation);
  for (const [phoneCountry, phone] of [
    ["PH", "9123456789"],
    ["GB", "07911123456"],
    ["TW", "912345678"],
    ["DE", "015123456789"],
  ])
    assert.ok(
      schema.safeParse({ ...values, phoneCountry, phone }).success,
      phoneCountry,
    );
  assert.equal(
    schema.safeParse({ ...values, phone: "0123456789" }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...values, phoneCountry: "invalid" }).success,
    false,
  );
  for (const lang of ["en", "zh"]) {
    const result = createApplicationSchema(
      applicationContent[lang].validation,
    ).safeParse({ ...values, phone: "+0164536156465" });
    assert.equal(result.success, false);
    assert.equal(
      result.error.issues[0].message,
      applicationContent[lang].validation.phone,
    );
  }
});

// Recheck validation when the transport is called independently of the form UI.
// A future caller must not send invalid contact information or unsigned consent to the API.
test("invalid application values never request an upload grant", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    throw new Error("Unexpected network request");
  });
  for (const change of [
    { email: "invalid" },
    { phone: "+0164536156465" },
    { consent: false },
    { resume: new File(["x"], "invalid.exe") },
  ]) {
    await assert.rejects(
      submitApplication(
        endpoints,
        "1042",
        "en",
        { ...values, ...change },
        captchaToken,
        "key",
        new AbortController().signal,
      ),
    );
  }
  assert.equal(requests.length, 0);
});

// Inspect the three-step delivery protocol with fetch fully intercepted in memory.
// Only the signed storage request contains raw bytes; the final application carries an opaque token.
test("application transport uses a signed upload, minimal metadata and explicit receipts", async (t) => {
  const calls = [];
  let receipt = { status: "accepted", confirmationEmailSent: true };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === endpoints.upload)
      return Response.json({
        uploadUrl: "https://storage.example.test/signed",
        resumeToken: "opaque-upload-token",
      });
    if (url === endpoints.applications) return Response.json(receipt);
    return new Response(null, { status: 200 });
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await submitApplication(
      endpoints,
      "1042",
      "zh",
      values,
      captchaToken,
      "stable-key",
      signal,
    ),
    receipt,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), [
    "contentType",
    "fileName",
    "jobId",
    "size",
  ]);
  assert.equal(calls[1].url, "https://storage.example.test/signed");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.body, values.resume);
  const application = JSON.parse(calls[2].options.body);
  assert.equal(application.resumeToken, "opaque-upload-token");
  assert.equal(application.captchaToken, captchaToken);
  assert.equal(application.consent, true);
  assert.equal(application.locale, "zh");
  assert.equal(application.phone, "+60123456789");
  assert.equal("phoneCountry" in application, false);
  assert.equal("resume" in application, false);
  assert.equal("coverLetter" in application, false);
  assert.equal(calls[2].options.headers["Idempotency-Key"], "stable-key");
  assert.ok(calls.every((call) => call.options.credentials === "omit"));
  receipt = { status: "duplicate", confirmationEmailSent: false };
  assert.equal(
    (
      await submitApplication(
        endpoints,
        "1042",
        "en",
        { ...values, coverLetter: "  Example letter  " },
        captchaToken,
        "stable-key",
        signal,
      )
    ).status,
    "duplicate",
  );
  assert.equal(
    JSON.parse(calls.at(-1).options.body).coverLetter,
    "Example letter",
  );
  assert.equal("coverLetter" in JSON.parse(calls.at(-3).options.body), false);
});

test("server rejection codes stay actionable and never expose server text", async (t) => {
  const responses = [
    [
      400,
      {
        error: "private SQL",
        issues: [
          { field: "phone", code: "invalid", value: "private" },
          { field: "password", code: "invalid" },
        ],
      },
      "validation",
    ],
    [
      400,
      { issues: [{ field: "resume", code: "upload_expired" }] },
      "validation",
    ],
    [400, { error: "private SQL" }, "invalidRequest"],
    [403, {}, "forbidden"],
    [409, {}, "conflict"],
    [429, {}, "rateLimited"],
    [503, {}, "unavailable"],
    [413, {}, "validation"],
    [400, { code: "captcha_failed" }, "captcha"],
  ];
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [status, body, code] of responses) {
    response = Response.json(body, {
      status,
      headers: { "Retry-After": "90" },
    });
    await assert.rejects(
      submitApplication(
        endpoints,
        "1042",
        "en",
        values,
        captchaToken,
        "key",
        new AbortController().signal,
      ),
      (error) => {
        assert.ok(error instanceof ApplicationSubmissionError);
        assert.equal(error.code, code);
        assert.ok(!JSON.stringify(error).includes("private"));
        if (code === "rateLimited") assert.equal(error.retryAfterSeconds, 90);
        if (status === 400 && body.issues?.[0]?.field === "phone")
          assert.deepEqual(error.issues, [{ field: "phone", code: "invalid" }]);
        return true;
      },
    );
  }
});

test("upload failures, lost receipts and timeouts are distinguished without false success", async (t) => {
  let mode = "upload";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (mode === "upload") throw new TypeError("Network failure");
    if (url === endpoints.upload)
      return Response.json({
        uploadUrl: "https://storage.example.test/cv",
        resumeToken: "token",
      });
    if (url === endpoints.applications) {
      if (mode === "receipt") return Response.json({});
      throw new TypeError("Network failure");
    }
    return new Response(null, { status: 200 });
  });
  for (const [nextMode, code] of [
    ["upload", "upload"],
    ["network", "network"],
    ["receipt", "unconfirmed"],
  ]) {
    mode = nextMode;
    await assert.rejects(
      submitApplication(
        endpoints,
        "1042",
        "en",
        values,
        captchaToken,
        "key",
        new AbortController().signal,
      ),
      (error) => error.code === code,
    );
  }
  const controller = new AbortController();
  controller.abort(new DOMException("Timeout", "TimeoutError"));
  mode = "upload";
  await assert.rejects(
    submitApplication(
      endpoints,
      "1042",
      "en",
      values,
      captchaToken,
      "key",
      controller.signal,
    ),
    (error) => error.code === "timeout",
  );
});

test("timeouts while reading either JSON response body retain timeout feedback", async (t) => {
  for (const delayed of [endpoints.upload, endpoints.applications]) {
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url === delayed)
        return {
          ok: true,
          status: 200,
          async json() {
            controller.abort(new DOMException("Timeout", "TimeoutError"));
            throw controller.signal.reason;
          },
        };
      if (url === endpoints.upload)
        return Response.json({
          uploadUrl: "https://storage.example.test/cv",
          resumeToken: "token",
        });
      return new Response(null, { status: 200 });
    });
    await assert.rejects(
      submitApplication(
        endpoints,
        "1042",
        "en",
        values,
        captchaToken,
        "key",
        controller.signal,
      ),
      (error) => error.code === "timeout",
    );
  }
});

// Fail closed for expired roles, rejected uploads and malformed acknowledgements.
// The drawer must never claim successful delivery from a partial or untrusted response.
test("application failures cannot become successful receipts", async (t) => {
  let mode = "closed";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (mode === "closed") return new Response(null, { status: 410 });
    if (url === endpoints.upload)
      return Response.json({
        uploadUrl:
          mode === "insecure"
            ? "http://storage.example.test/file"
            : "https://storage.example.test/file",
        resumeToken: "token",
      });
    if (url === endpoints.applications) return Response.json({});
    return new Response(null, { status: mode === "upload-failed" ? 503 : 200 });
  });
  const deliver = () =>
    submitApplication(
      endpoints,
      "1042",
      "en",
      values,
      captchaToken,
      "key",
      new AbortController().signal,
    );
  await assert.rejects(deliver(), ApplicationClosedError);
  mode = "insecure";
  await assert.rejects(deliver());
  assert.equal(
    calls.filter((url) => url.startsWith("http://storage")).length,
    0,
  );
  mode = "upload-failed";
  await assert.rejects(deliver());
  assert.equal(calls.includes(endpoints.applications), false);
  mode = "invalid-receipt";
  await assert.rejects(deliver());
});
