import {
  before,
  after,
  beforeEach,
  afterEach,
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  privacyDatabase,
  actorContext,
  scoped,
  command,
  worker,
  candidate,
  application,
  request,
} from "./helpers.mjs";

describe("Privacy workflow, retention and cleanup (isolated PostgreSQL)", () => {
  let f;
  before(async () => {
    f = await privacyDatabase();
  });
  after(async () => f?.db.close());
  beforeEach(async () => {
    await f.db.exec("BEGIN");
    await actorContext(f);
  });
  afterEach(async () => f.db.exec("ROLLBACK"));
  const row = async (id) =>
    (
      await f.db.query("SELECT * FROM portal.deletion_requests WHERE id=$1", [
        id,
      ])
    ).rows[0];

  test("privacy dependency repair restores staff reads without widening worker access", async () => {
    const c = await candidate(f);
    const fresh = await application(f, c);
    await f.db.exec(
      "REVOKE EXECUTE ON FUNCTION portal_private.candidate_group_blocked(uuid) FROM portal_privacy_owner",
    );
    await assert.rejects(
      scoped(f.db, "portal_runtime", "SELECT id FROM portal.applications"),
      { code: "42501" },
    );
    const repair = readFileSync(
      "prisma/migrations/20261102000100_privacy_dependency_permissions/migration.sql",
      "utf8",
    )
      .replace(/^BEGIN;/, "")
      .replace(/COMMIT;\s*$/, "");
    await f.db.exec(repair);
    const visible = await scoped(
      f.db,
      "portal_runtime",
      "SELECT id FROM portal.applications",
    );
    assert.deepEqual(
      visible.rows.map((row) => row.id),
      [fresh.id],
    );
    const candidates = await scoped(
      f.db,
      "portal_runtime",
      "SELECT id FROM portal.candidates",
    );
    assert.deepEqual(
      candidates.rows.map((row) => row.id),
      [c],
    );
    await assert.rejects(
      scoped(f.db, "portal_privacy_worker", "SELECT * FROM portal.candidates"),
      { code: "42501" },
    );
  });

  test("ADMIN admission and narrow worker capabilities are independently enforced", async () => {
    for (const role of ["HR", "READ_ONLY"]) {
      await actorContext(f, role);
      await assert.rejects(
        command(f, "policy", randomUUID(), 1, {
          retentionMonths: 24,
          evidenceMonths: 24,
          retentionEnabled: true,
        }),
        { code: "42501" },
      );
    }
    await actorContext(f, "ADMIN", false);
    await assert.rejects(command(f, "request", randomUUID(), null, {}), {
      code: "42501",
    });
    await actorContext(f);
    for (const role of [
      "portal_runtime",
      "anon",
      "authenticated",
      "service_role",
    ]) {
      await assert.rejects(
        scoped(f.db, role, "SELECT portal_private.prepare_privacy_cleanup(20)"),
        { code: "42501" },
      );
    }
    await assert.rejects(
      scoped(f.db, "portal_privacy_worker", "SELECT * FROM portal.candidates"),
      { code: "42501" },
    );
    await assert.rejects(
      scoped(f.db, "portal_runtime", "DELETE FROM portal.candidates"),
      { code: "42501" },
    );
    await assert.rejects(
      scoped(
        f.db,
        "portal_runtime",
        "SELECT portal_private.complete_privacy_groups(20)",
      ),
      { code: "42501" },
    );
  });

  test("retention expiry is immutable, read-enforced, and automatic deletion is opt-in", async () => {
    const c = await candidate(f, 25),
      old = await application(f, c, 25),
      fresh = await application(f, c);
    const visible = await scoped(
      f.db,
      "portal_runtime",
      "SELECT id FROM portal.applications WHERE candidate_id=$1",
      [c],
    );
    assert.deepEqual(
      visible.rows.map((r) => r.id),
      [fresh.id],
    );
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 0);
    await f.db.query(
      "UPDATE portal.uploads SET access_revoked_at=NULL WHERE id=ANY($1::uuid[])",
      [[old.upload, fresh.upload]],
    );
    await scoped(
      f.db,
      "portal_runtime",
      "SELECT portal_private.record_cv_access($1,$2)",
      [fresh.id, randomUUID()],
    );
    await assert.rejects(
      scoped(
        f.db,
        "portal_runtime",
        "SELECT portal_private.record_cv_access($1,$2)",
        [old.id, randomUUID()],
      ),
      { code: "42501" },
    );
    await assert.rejects(
      scoped(
        f.db,
        "portal_runtime",
        "SELECT portal_private.application_upload($1,$2)",
        [old.upload, old.cap],
      ),
      { code: "22023" },
    );
    await f.db.query(
      "UPDATE portal.uploads SET access_revoked_at=now()-interval '10 minutes' WHERE id=ANY($1::uuid[])",
      [[old.upload, fresh.upload]],
    );
    await f.db.exec("SAVEPOINT immutable");
    await assert.rejects(
      f.db.query(
        "UPDATE portal.applications SET retention_expires_at=now()+interval '5 years' WHERE id=$1",
        [old.id],
      ),
      { code: "22023" },
    );
    await f.db.exec(
      "ROLLBACK TO SAVEPOINT immutable; RELEASE SAVEPOINT immutable",
    );
    await command(f, "policy", randomUUID(), 1, {
      retentionMonths: 24,
      evidenceMonths: 24,
      retentionEnabled: true,
    });
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 1);
    const claims = await worker(f, "claim_privacy_cleanup", [5]);
    assert.equal(claims.length, 1);
    await worker(f, "finish_privacy_cleanup", [
      old.id,
      claims[0].leaseToken,
      true,
    ]);
    await worker(f, "privacy_cleanup_summary");
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.candidates WHERE id=$1",
          [c],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.applications WHERE id=$1",
          [fresh.id],
        )
      ).rows[0].n,
      1,
    );
  });

  test("requests are idempotent, calendar-month due dates do not wait for verification", async () => {
    const c = await candidate(f);
    await application(f, c);
    const year = new Date().getUTCFullYear() - 2;
    const receivedAt = new Date(Date.UTC(year, 0, 31, 12)).toISOString();
    const dueAt = new Date(Date.UTC(year, 2, 0, 12)).toISOString();
    const id = randomUUID(),
      key = randomUUID(),
      body = { candidateId: c, requesterRef: randomUUID(), receivedAt };
    await command(f, "request", id, null, body, key);
    assert.deepEqual(await command(f, "request", id, null, body, key), {
      id,
      version: 1,
    });
    assert.equal(new Date((await row(id)).due_at).toISOString(), dueAt);
    await assert.rejects(
      command(
        f,
        "request",
        id,
        null,
        { ...body, requesterRef: randomUUID() },
        key,
      ),
      { code: "40001" },
    );
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 0);
    assert.equal(
      (
        await scoped(
          f.db,
          "portal_runtime",
          "SELECT id FROM portal.candidates WHERE id=$1",
          [c],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(command(f, "verify", id, 2), { code: "40001" });
    await command(f, "verify", id, 1);
    assert.equal(new Date((await row(id)).due_at).toISOString(), dueAt);
    assert.equal((await worker(f, "privacy_cleanup_summary")).overdue, 1);
  });

  test("verified erasure spans aliases, retries provider failures, and completes only after every CV", async () => {
    const c = await candidate(f),
      alias = await candidate(f);
    const first = await application(f, c),
      second = await application(f, alias);
    await f.db.query(
      "UPDATE portal.candidates SET merged_into_id=$1 WHERE id=$2",
      [c, alias],
    );
    const id = await request(f, alias);
    await command(f, "verify", id, 1);
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 2);
    assert.equal((await row(id)).state, "PROCESSING");
    await assert.rejects(
      command(f, "hold", c, 0, {
        caseRef: randomUUID(),
        reasonCode: "LEGAL_CLAIM",
        until: new Date(Date.now() + 86400000).toISOString(),
      }),
      { code: "55000" },
    );
    const claims = await worker(f, "claim_privacy_cleanup", [5]);
    const one = claims.find((claim) => claim.applicationId === first.id),
      two = claims.find((claim) => claim.applicationId === second.id);
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        one.applicationId,
        randomUUID(),
        true,
      ]),
      false,
    );
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        one.applicationId,
        one.leaseToken,
        false,
      ]),
      false,
    );
    await worker(f, "finish_privacy_cleanup", [
      two.applicationId,
      two.leaseToken,
      true,
    ]);
    await worker(f, "privacy_cleanup_summary");
    assert.equal((await row(id)).state, "PROCESSING");
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.applications WHERE id=$1",
          [first.id],
        )
      ).rows[0].n,
      1,
    );
    await f.db.exec(
      "UPDATE portal_private.privacy_erasure_jobs SET available_at=now()-interval '1 second'",
    );
    const [retry] = await worker(f, "claim_privacy_cleanup", [5]);
    assert.notEqual(retry.leaseToken, one.leaseToken);
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        one.applicationId,
        one.leaseToken,
        true,
      ]),
      false,
    );
    await worker(f, "finish_privacy_cleanup", [
      retry.applicationId,
      retry.leaseToken,
      true,
    ]);
    const summary = await worker(f, "privacy_cleanup_summary");
    assert.equal(summary.completed, 1);
    assert.equal((await row(id)).state, "COMPLETED");
    assert.equal((await row(id)).candidate_id, null);
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.candidates WHERE id=ANY($1::uuid[])",
          [[c, alias]],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.uploads WHERE id=ANY($1::uuid[])",
          [[first.upload, second.upload]],
        )
      ).rows[0].n,
      0,
    );
    const evidence = (
      await f.db.query(
        "SELECT safe_changes FROM portal.audit_logs WHERE object_id=$1 AND action='DELETION_COMPLETED'",
        [id],
      )
    ).rows;
    assert.equal(evidence.length, 1);
    assert.deepEqual(Object.keys(evidence[0].safe_changes).sort(), [
      "id",
      "version",
    ]);
  });

  test("legal holds protect retention and requests, expire explicitly, and preserve due dates", async () => {
    const c = await candidate(f, 25);
    await application(f, c, 25);
    await command(f, "policy", randomUUID(), 1, {
      retentionMonths: 24,
      evidenceMonths: 24,
      retentionEnabled: true,
    });
    const hold = {
      caseRef: randomUUID(),
      reasonCode: "LEGAL_CLAIM",
      until: new Date(Date.now() + 86400000).toISOString(),
    };
    await command(f, "hold", c, 0, hold);
    const id = await request(f, c);
    await command(f, "verify", id, 1);
    const deadline = (await row(id)).due_at;
    assert.equal((await row(id)).state, "ON_HOLD");
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 0);
    await assert.rejects(command(f, "release", c, 2), { code: "40001" });
    await command(f, "release", c, 1);
    assert.equal((await row(id)).state, "VERIFIED");
    assert.deepEqual((await row(id)).due_at, deadline);
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 1);
  });

  test("active provider upload and previously signed download windows delay physical removal", async () => {
    const c = await candidate(f);
    const app = await application(f, c, 0, {
      liveUploadToken: true,
      notRevoked: true,
    });
    const id = await request(f, c);
    await command(f, "verify", id, 1);
    await worker(f, "prepare_privacy_cleanup", [20]);
    assert.deepEqual(await worker(f, "claim_privacy_cleanup", [5]), []);
    await f.db.exec(
      "UPDATE portal_private.privacy_erasure_jobs SET available_at=now()-interval '1 day'",
    );
    assert.deepEqual(await worker(f, "claim_privacy_cleanup", [5]), []);
    assert.equal((await row(id)).state, "PROCESSING");
    assert.equal(
      (
        await f.db.query(
          "SELECT access_revoked_at IS NOT NULL revoked FROM portal.uploads WHERE id=$1",
          [app.upload],
        )
      ).rows[0].revoked,
      true,
    );
  });

  test("public receipt requests do not disclose matches or authorize deletion", async () => {
    const c = await candidate(f);
    const app = await application(f, c, 0, { notRevoked: true });
    const invalid = randomUUID(),
      valid = randomUUID();
    await scoped(
      f.db,
      "portal_runtime",
      "SELECT portal_private.request_privacy_from_receipt($1,$2,$3)",
      [app.upload, randomBytes(32), invalid],
    );
    assert.equal(await row(invalid), undefined);
    for (let i = 0; i < 2; i++)
      await scoped(
        f.db,
        "portal_runtime",
        "SELECT portal_private.request_privacy_from_receipt($1,$2,$3)",
        [app.upload, app.cap, valid],
      );
    assert.equal((await row(valid)).state, "REQUESTED");
    assert.equal((await worker(f, "prepare_privacy_cleanup", [20])).queued, 0);
    assert.equal(
      (await f.db.query("SELECT count(*)::int n FROM portal.deletion_requests"))
        .rows[0].n,
      1,
    );
  });

  test("reject restores recruitment access; unsafe reasons and unknown properties are rejected", async () => {
    const c = await candidate(f);
    await application(f, c);
    const id = await request(f, c);
    await assert.rejects(
      command(f, "reject", id, 1, { reasonCode: "private name" }),
      { code: "22023" },
    );
    await assert.rejects(command(f, "verify", id, 1, { force: true }), {
      code: "22023",
    });
    await command(f, "reject", id, 1, { reasonCode: "IDENTITY_UNVERIFIED" });
    assert.equal(
      (
        await scoped(
          f.db,
          "portal_runtime",
          "SELECT id FROM portal.candidates WHERE id=$1",
          [c],
        )
      ).rows.length,
      1,
    );
  });

  test("shortening a policy affects existing data; increasing it never extends an assigned deadline", async () => {
    const existingCandidate = await candidate(f);
    const existingApp = await application(f, existingCandidate, 2);
    await command(f, "policy", randomUUID(), 1, {
      retentionMonths: 1,
      evidenceMonths: 1,
      retentionEnabled: false,
    });
    const c = await candidate(f),
      app = await application(f, c, 2);
    const expiry = (
      await f.db.query(
        "SELECT retention_expires_at FROM portal.applications WHERE id=$1",
        [app.id],
      )
    ).rows[0].retention_expires_at;
    await command(f, "policy", randomUUID(), 2, {
      retentionMonths: 24,
      evidenceMonths: 24,
      retentionEnabled: false,
    });
    const visible = await scoped(
      f.db,
      "portal_runtime",
      "SELECT id FROM portal.applications WHERE id=$1",
      [app.id],
    );
    assert.equal(visible.rows.length, 0);
    assert.equal(
      (
        await scoped(
          f.db,
          "portal_runtime",
          "SELECT id FROM portal.applications WHERE id=$1",
          [existingApp.id],
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT retention_expires_at FROM portal.applications WHERE id=$1",
          [app.id],
        )
      ).rows[0].retention_expires_at,
      expiry,
    );
  });

  test("erasure scrubs linked audit, outbox and command references while retaining minimal evidence", async () => {
    const c = await candidate(f),
      app = await application(f, c);
    await f.db.query(
      "INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id) VALUES('APPLICATION',$1,'CONFIRMED',$2,$3)",
      [
        app.id,
        JSON.stringify({ candidateId: c, uploadId: app.upload }),
        randomUUID(),
      ],
    );
    await f.db.query(
      "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('CONFIRMED',$1,$2,$3)",
      [app.id, randomUUID(), JSON.stringify({ id: app.id })],
    );
    await f.db.query(
      "INSERT INTO portal_private.recruitment_commands(request_id,actor_id,command,result) VALUES($1,$2,$3,'{}')",
      [randomUUID(), f.actors.ADMIN.id, JSON.stringify({ id: app.id })],
    );
    const id = await request(f, c);
    await command(f, "verify", id, 1);
    await worker(f, "prepare_privacy_cleanup", [20]);
    const [claim] = await worker(f, "claim_privacy_cleanup", [5]);
    await worker(f, "finish_privacy_cleanup", [app.id, claim.leaseToken, true]);
    await worker(f, "privacy_cleanup_summary");
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.audit_logs WHERE object_id=$1 OR safe_changes->>'candidateId'=$2",
          [app.id, c],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.outbox_events WHERE aggregate_id=$1",
          [app.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal_private.recruitment_commands WHERE command->>'id'=$1",
          [app.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM portal.audit_logs WHERE object_type='PRIVACY_ERASURE' AND action='PERSONAL_DATA_ERASED'",
        )
      ).rows[0].n,
      1,
    );
  });

  test("evidence expiry is bounded and leaves open, overdue requests visible for escalation", async () => {
    const c = await candidate(f),
      closed = await request(f, c);
    await command(f, "reject", closed, 1, { reasonCode: "NOT_APPLICABLE" });
    const old = new Date();
    old.setUTCFullYear(old.getUTCFullYear() - 3);
    await f.db.exec(
      "ALTER TABLE portal.deletion_requests DISABLE TRIGGER touch_updated_at",
    );
    await f.db.query(
      "UPDATE portal.deletion_requests SET updated_at=$1,requested_at=$1,due_at=$1 WHERE id=$2",
      [old.toISOString(), closed],
    );
    await f.db.exec(
      "ALTER TABLE portal.deletion_requests ENABLE TRIGGER touch_updated_at",
    );
    const open = await request(f, c);
    await f.db.query(
      "UPDATE portal.deletion_requests SET requested_at=now()-interval '2 months',due_at=now()-interval '1 month' WHERE id=$1",
      [open],
    );
    const summary = await worker(f, "privacy_cleanup_summary");
    assert.equal(await row(closed), undefined);
    assert.equal((await row(open)).state, "REQUESTED");
    assert.equal(summary.overdue, 1);
  });

  test("expired leases cannot finalize a later worker's claim", async () => {
    const c = await candidate(f),
      app = await application(f, c),
      id = await request(f, c);
    await command(f, "verify", id, 1);
    await worker(f, "prepare_privacy_cleanup", [20]);
    const [first] = await worker(f, "claim_privacy_cleanup", [5]);
    await f.db.exec(
      "UPDATE portal_private.privacy_erasure_jobs SET lease_until=now()-interval '1 second'",
    );
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        app.id,
        first.leaseToken,
        true,
      ]),
      false,
    );
    const [second] = await worker(f, "claim_privacy_cleanup", [5]);
    assert.notEqual(first.leaseToken, second.leaseToken);
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        app.id,
        first.leaseToken,
        true,
      ]),
      false,
    );
    assert.equal(
      await worker(f, "finish_privacy_cleanup", [
        app.id,
        second.leaseToken,
        true,
      ]),
      true,
    );
  });
});
