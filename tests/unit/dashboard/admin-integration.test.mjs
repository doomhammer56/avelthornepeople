import test from "node:test";
import assert from "node:assert/strict";
import {
  adminJobDto,
  adminApplicationDto,
} from "../../../src/server/admin/dto.ts";
import { sendStaffCommand } from "../../../src/lib/admin/staffClient.ts";
import {
  requestCvDownload,
  requestCvPreview,
} from "../../../src/lib/admin/cvDownload.ts";
import { visibleNavGroups, pageTitle } from "../../../src/lib/admin/nav.ts";

const id = "11111111-1111-1111-1111-111111111111";
test("Sidebar permissions match backend roles and nested pages retain the correct section title", () => {
  const keys = (role) =>
    visibleNavGroups(role).flatMap((group) =>
      group.items.map((item) => item.key),
    );
  assert.deepEqual(keys("READ_ONLY").sort(), ["jobs", "content"].sort());
  assert.ok(!keys("HR").includes("accounts"));
  assert.ok(!keys("HR").includes("log"));
  assert.equal(pageTitle("/admin/applications/real-id", "en"), "Applications");
  assert.equal(pageTitle("/admin/jobs/real-id/edit", "en"), "Jobs");
});
test("Admin jobs preserve exact public eligibility, optional deadlines and unavailable restricted counts", () => {
  const row = {
    id,
    canonical_slug: "real-job",
    draft_content: { en: { title: "Draft title" }, zh: { title: "草稿" } },
    status: "PUBLISHED",
    location_ids: ["location-a", "location-b"],
    department_id: "department",
    job_type: "FULL_TIME",
    created_at: "2026-10-25T10:00:00Z",
    publish_at: "2026-10-25T12:00:00Z",
    close_at: null,
    live: false,
    applications: null,
  };
  const job = adminJobDto(row);
  assert.equal(job.live, false);
  assert.equal(job.applications, null);
  assert.equal(job.closeAt, null);
  assert.equal(job.closesAt, "");
  assert.equal(job.title.en, "Draft title");
  assert.deepEqual(job.locationIds, ["location-a", "location-b"]);
});
test("Application metadata never decodes or serializes encrypted candidate values", () => {
  const row = {
    id,
    job_id: id,
    candidate_id: id,
    source: "unknown",
    status: "NEW",
    submitted_at: "2026-10-25T12:00:00Z",
    consent_at: "2026-10-25T12:00:00Z",
    policy_version: "v1",
    cv_available: true,
    duplicate_candidate_match: true,
    profile_encrypted: Buffer.from("private"),
    name_encrypted: Buffer.from("private"),
    email: "must-not-leak@example.invalid",
  };
  const dto = adminApplicationDto(row);
  assert.equal(dto.profileAvailable, false);
  assert.equal(dto.name, "");
  assert.equal(dto.email, "");
  assert.equal(dto.source, "other");
  assert.equal(dto.cvAvailable, true);
  assert.equal(dto.status, "New");
  assert.equal(dto.duplicate, true);
  assert.equal(
    adminApplicationDto({
      ...row,
      consent_at: new Date("2026-10-25T12:00:00.123Z"),
    }).consentAt,
    "2026-10-25T12:00:00.123Z",
  );
  assert.ok(!JSON.stringify(dto).includes("private"));
  assert.ok(!JSON.stringify(dto).includes("must-not-leak"));
});
test("Account changes use the real mutation endpoint and keep pending provider synchronization explicit", async () => {
  const body = {
    action: "change",
    requestId: id,
    userId: id,
    role: "HR",
    active: true,
    expectedVersion: 1,
  };
  const result = await sendStaffCommand(body, async (url, options) => {
    assert.equal(url, "/api/admin/staff");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body), body);
    return Response.json(
      { userId: id, version: 2, operationId: id, providerSync: "pending" },
      { status: 202 },
    );
  });
  assert.equal(result.providerSync, "pending");
  await assert.rejects(
    sendStaffCommand(body, async () =>
      Response.json({ error: "conflict" }, { status: 409 }),
    ),
    { status: 409 },
  );
  await assert.rejects(
    sendStaffCommand(body, async () => Response.json({})),
    { status: 503 },
  );
});
test("CV downloads are requested only on demand and reject denial, unsafe URL or inline responses", async () => {
  const response = {
    url: "https://storage.example.test/storage/v1/object/sign/cv-clean/file?token=opaque",
    expiresAt: "2026-10-25T12:01:00Z",
    disposition: "attachment",
  };
  const url = await requestCvDownload(id, async (endpoint, options) => {
    assert.equal(
      endpoint,
      `/api/admin/applications/${id}/cv-url?mode=download`,
    );
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    return Response.json(response);
  });
  assert.equal(url, response.url);
  await assert.rejects(
    requestCvDownload(id, async () => Response.json({}, { status: 403 })),
    { status: 403 },
  );
  for (const overrides of [
    { url: "javascript:alert(1)" },
    { url: "http://unsafe.invalid/file" },
    { disposition: "inline" },
  ])
    await assert.rejects(
      requestCvDownload(id, async () =>
        Response.json({ ...response, ...overrides }),
      ),
      { status: 503 },
    );
});

test("PDF preview requests inline URLs on demand and rejects Word attachments or unsafe URLs", async () => {
  const response = {
    url: "https://storage.example.test/storage/v1/object/sign/cv-quarantine/file?token=opaque",
    expiresAt: "2026-10-28T12:01:00Z",
    disposition: "inline",
  };
  assert.equal(
    await requestCvPreview(id, async (endpoint, options) => {
      assert.equal(
        endpoint,
        `/api/admin/applications/${id}/cv-url?mode=preview`,
      );
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      return Response.json(response);
    }),
    response.url,
  );
  await assert.rejects(
    () =>
      requestCvPreview(id, async () =>
        Response.json({ ...response, disposition: "attachment" }),
      ),
    { status: 415 },
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:password@unsafe.invalid/file",
    "http://unsafe.invalid/file",
  ])
    await assert.rejects(
      () =>
        requestCvPreview(id, async () => Response.json({ ...response, url })),
      { status: 503 },
    );
});
