import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAdminAdmission,
  resumeCheck,
} from "../../../src/lib/admin/admission.ts";
import { AdminRequestError } from "../../../src/lib/admin/staffClient.ts";

const staff = { id: "admin", role: "ADMIN" };

test("a denied module request does not revoke a verified console session", async () => {
  assert.equal(await checkAdminAdmission(staff, async () => staff), "allowed");
});

test("role and account changes discard the previous console identity", async () => {
  for (const current of [
    { ...staff, role: "HR" },
    { ...staff, id: "another" },
  ])
    assert.equal(
      await checkAdminAdmission(staff, async () => current),
      "changed",
    );
});

test("only confirmed admission failures select login/denied; outages remain retryable", async () => {
  for (const [status, decision] of [
    [401, "login"],
    [403, "denied"],
    [503, "unavailable"],
  ])
    assert.equal(
      await checkAdminAdmission(staff, async () => {
        throw new AdminRequestError(status);
      }),
      decision,
    );
  assert.equal(
    await checkAdminAdmission(staff, async () => {
      throw new TypeError("Network unavailable");
    }),
    "unavailable",
  );
});

test("returning to a tab never blanks the page unless the session may have expired", () => {
  assert.equal(resumeCheck(5_000), "skip");
  assert.equal(resumeCheck(59_999), "skip");
  assert.equal(resumeCheck(60_000), "silent");
  assert.equal(resumeCheck(10 * 60_000), "silent");
  assert.equal(resumeCheck(15 * 60_000), "blocking");
  assert.equal(resumeCheck(8 * 60 * 60_000), "blocking");
});
