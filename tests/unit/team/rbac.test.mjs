import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  can,
  permissions,
  rolesFor,
  roleScope,
} from "../../../src/lib/auth/permissions.ts";
import {
  visibleNavGroups,
  adminLanguageHref,
} from "../../../src/lib/admin/nav.ts";
import { staffCommand } from "../../../src/server/team/contract.ts";
import { sendStaffCommand } from "../../../src/lib/admin/staffClient.ts";

test("Admin language switching keeps filters, repeated statuses, pagination and the fragment", () => {
  const href = adminLanguageHref(
    "http://localhost:3000/admin/jobs?status=published&status=paused&q=engineer&page=2&lang=en#results",
    "zh",
  );
  const url = new URL(href, "https://console.invalid");
  assert.deepEqual(url.searchParams.getAll("status"), ["published", "paused"]);
  assert.equal(url.searchParams.get("q"), "engineer");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("lang"), "zh");
  assert.equal(url.hash, "#results");
});

test("The fixed permission matrix preserves Admin/HR/Read-Only boundaries and rejects unknown roles", () => {
  for (const permission of Object.keys(permissions))
    assert.equal(can("ADMIN", permission), true);
  for (const role of ["ADMIN", "HR", "READ_ONLY"]) {
    for (const permission of [
      "console.read",
      "jobs.read",
      "content.read",
      "lookups.read",
    ])
      assert.equal(can(role, permission), true);
    assert.ok(roleScope[role].en && roleScope[role].zh);
  }
  for (const permission of [
    "dashboard.read",
    "applications.read",
    "applications.write",
    "cv.read",
    "jobs.write",
  ]) {
    assert.equal(can("HR", permission), true);
    assert.equal(can("READ_ONLY", permission), false);
  }
  for (const permission of [
    "jobs.publish",
    "content.write",
    "team.manage",
    "team.read",
    "settings.read",
    "audit.read",
  ])
    assert.equal(can("HR", permission), false);
  for (const role of [
    undefined,
    null,
    "admin",
    "SUPERADMIN",
    { role: "ADMIN" },
  ])
    assert.equal(can(role, "team.manage"), false);
  assert.deepEqual(rolesFor("unknown.permission"), []);
});
test("Navigation follows the same policy and every destination has an explicit permission", () => {
  for (const role of ["ADMIN", "HR", "READ_ONLY"]) {
    const items = visibleNavGroups(role).flatMap((g) => g.items);
    assert.ok(items.every((item) => can(role, item.permission)));
    assert.equal(
      items.some((item) => item.key === "accounts"),
      role === "ADMIN",
    );
    assert.equal(
      items.some((item) => item.key === "applications"),
      role !== "READ_ONLY",
    );
  }
  assert.deepEqual(visibleNavGroups("UNKNOWN"), []);
});
test("Team command validation rejects mass assignment, missing versions, role spoofing and malformed identities", () => {
  const requestId = randomUUID(),
    userId = randomUUID();
  const change = {
    action: "change",
    userId,
    role: "HR",
    active: true,
    expectedVersion: 1,
    requestId,
  };
  assert.ok(staffCommand.safeParse(change).success);
  for (const body of [
    { ...change, role: "SUPERADMIN" },
    { ...change, expectedVersion: undefined },
    { ...change, expectedVersion: 0 },
    { ...change, active: "true" },
    { ...change, permissions: ["team.manage"] },
    { ...change, userId: "not-a-uuid" },
    {
      action: "link",
      userId,
      displayName: "New member",
      requestId,
      role: "SUPERADMIN",
    },
    {
      action: "invite",
      email: "member@example.invalid",
      displayName: "Name",
      requestId,
      active: "yes",
    },
    {
      action: "invite",
      email: "member@example.invalid",
      displayName: "Name",
      requestId,
      permissions: ["team.manage"],
    },
    { action: "reconcile", operationId: userId, requestId, role: "ADMIN" },
    // Deleting needs the version the admin saw and nothing else.
    { action: "delete", userId, requestId },
    { action: "delete", userId, requestId, expectedVersion: 0 },
    { action: "delete", userId, requestId, expectedVersion: 1, role: "ADMIN" },
    { action: "delete", userId: "not-a-uuid", requestId, expectedVersion: 1 },
  ])
    assert.ok(!staffCommand.safeParse(body).success);
  // Invitations may carry the chosen role and whether to activate at once.
  for (const body of [
    {
      action: "invite",
      email: "member@example.invalid",
      displayName: "Name",
      requestId,
      role: "HR",
      active: true,
      lang: "zh",
    },
    { action: "link", userId, displayName: "Name", requestId, role: "ADMIN" },
    { action: "delete", userId, requestId, expectedVersion: 3 },
  ])
    assert.ok(staffCommand.safeParse(body).success, JSON.stringify(body));
  const invite = staffCommand.parse({
    action: "invite",
    email: " Member@Example.invalid ",
    displayName: " 中文 Member ",
    requestId,
  });
  assert.equal(invite.email, "member@example.invalid");
  assert.equal(invite.displayName, "中文 Member");
});
test("The team client accepts committed versions/pending operations and rejects incomplete success responses", async () => {
  const id = randomUUID(),
    requestId = randomUUID(),
    body = {
      action: "change",
      userId: id,
      role: "HR",
      active: true,
      expectedVersion: 1,
      requestId,
    };
  const result = await sendStaffCommand(body, async () =>
    Response.json(
      {
        userId: id,
        version: 2,
        providerSync: "pending",
        operationId: requestId,
      },
      { status: 202 },
    ),
  );
  assert.equal(result.version, 2);
  assert.equal(result.providerSync, "pending");
  await assert.rejects(
    sendStaffCommand(body, async () =>
      Response.json({ userId: id, providerSync: "complete" }),
    ),
    { status: 503 },
  );
  await assert.rejects(
    sendStaffCommand(body, async () =>
      Response.json({ error: "conflict" }, { status: 409 }),
    ),
    { status: 409 },
  );
});
