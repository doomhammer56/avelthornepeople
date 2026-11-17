import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { intakeErrorResponse } from "../../../src/server/applications/intake.ts";
import {
  intakeIssues,
  ApplicationInputError,
} from "../../../src/server/applications/intake-feedback.ts";
import { uploadRequest } from "../../../src/server/applications/intake-contract.ts";
import { StaffAuthError } from "../../../src/server/auth/errors.ts";
import { applicationContent } from "../../../src/lib/applicationContent.ts";
import {
  applicationIssueMessage,
  safeApplicationIssues,
} from "../../../src/lib/applicationFeedback.ts";

test("upload validation returns actionable CV errors without echoing input", async () => {
  const valid = {
    jobId: randomUUID(),
    fileName: "cv.pdf",
    contentType: "application/pdf",
    size: 100,
  };
  for (const [change, code] of [
    [{ size: 10_000_001 }, "resume_size"],
    [{ size: 0 }, "resume_empty"],
    [{ contentType: "text/plain" }, "resume_type"],
    [{ fileName: "private.exe" }, "resume_type"],
    [{ fileName: "x".repeat(256) }, "file_name"],
  ]) {
    const result = uploadRequest.safeParse({ ...valid, ...change });
    assert.equal(result.success, false);
    const response = intakeErrorResponse(result.error);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.deepEqual(payload.issues[0], { field: "resume", code });
    assert.ok(!JSON.stringify(payload).includes("private.exe"));
  }
});

test("operational errors keep their status and retry delay while hiding internal messages", async () => {
  for (const [error, status] of [
    [new Error("private provider secret"), 503],
    [Object.assign(new Error("private SQL"), { code: "40001" }), 409],
    [new StaffAuthError(403), 403],
    [new StaffAuthError(429, "traffic_limited", 90), 429],
  ]) {
    const response = intakeErrorResponse(error);
    assert.equal(response.status, status);
    assert.ok(!JSON.stringify(await response.json()).includes("private"));
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "90");
  }
  assert.deepEqual(
    intakeIssues(
      new ApplicationInputError([{ field: "resume", code: "upload_expired" }]),
    ),
    [{ field: "resume", code: "upload_expired" }],
  );
});

test("only allowed fields and codes reach translated feedback", () => {
  assert.deepEqual(
    safeApplicationIssues([
      { field: "phone", code: "invalid", value: "secret" },
      { field: "password", code: "invalid" },
      { field: "name", code: "SQL private" },
    ]),
    [{ field: "phone", code: "invalid" }],
  );
  for (const lang of ["en", "zh"]) {
    const t = applicationContent[lang];
    for (const issue of [
      { field: "phone", code: "invalid" },
      { field: "email", code: "required" },
      { field: "resume", code: "resume_invalid" },
      { field: "resume", code: "upload_expired" },
      { field: "consent", code: "invalid" },
    ]) {
      assert.ok(applicationIssueMessage(issue, t).length > 0);
      assert.notEqual(applicationIssueMessage(issue, t), t.validation.required);
    }
  }
});
