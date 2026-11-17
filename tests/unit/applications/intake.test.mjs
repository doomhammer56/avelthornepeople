import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  intakeRequest,
  uploadRequest,
} from "../../../src/server/applications/intake-contract.ts";
import { validateCvBytes } from "../../../src/server/applications/intake-file.ts";

test("Public intake requires consent, bounded fields, international phone and bound upload capability", () => {
  const input = {
    jobId: randomUUID(),
    locale: "en",
    name: "Applicant",
    email: "applicant@example.invalid",
    phone: "+60123456789",
    resumeToken: `${randomUUID()}.${"a".repeat(43)}`,
    consent: true,
    consentVersion: "recruitment-24-months-v1",
    captchaToken: "test-turnstile-token",
  };
  assert.ok(intakeRequest.safeParse(input).success);
  for (const change of [
    { consent: false },
    { consentVersion: "other" },
    { phone: "0123456789" },
    { name: "a".repeat(121) },
    { resumeToken: "x" },
    { candidateId: randomUUID() },
  ])
    assert.equal(
      intakeRequest.safeParse({ ...input, ...change }).success,
      false,
    );
  assert.ok(
    uploadRequest.safeParse({
      jobId: input.jobId,
      fileName: "cv.pdf",
      contentType: "application/pdf",
      size: 100,
    }).success,
  );
  for (const change of [
    { size: 10000001 },
    { size: 0 },
    { fileName: "cv.exe" },
    { contentType: "text/html" },
  ])
    assert.equal(
      uploadRequest.safeParse({
        jobId: input.jobId,
        fileName: "cv.pdf",
        contentType: "application/pdf",
        size: 100,
        ...change,
      }).success,
      false,
    );
});

test("CV validation checks exact byte length and document signatures without claiming a malware scan", () => {
  const pdf = Buffer.from("%PDF-1.7\nsynthetic fixture\n%%EOF");
  assert.equal(validateCvBytes(pdf, "application/pdf", pdf.length).length, 32);
  const doc = Buffer.concat([
    Buffer.from("d0cf11e0a1b11ae1", "hex"),
    Buffer.from("WordDocument", "utf16le"),
  ]);
  assert.equal(
    validateCvBytes(doc, "application/msword", doc.length).length,
    32,
  );
  for (const [bytes, type, size] of [
    [pdf, "application/msword", pdf.length],
    [pdf, "application/pdf", pdf.length + 1],
    [Buffer.from("<script>"), "application/pdf", 8],
    [pdf.subarray(0, 10), "application/pdf", 10],
  ])
    assert.throws(() => validateCvBytes(bytes, type, size));
});
