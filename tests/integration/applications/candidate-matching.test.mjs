import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  applicationMatchFlags,
  findContactMatches,
} from "../../../src/server/candidates/service.ts";
import {
  encryptedCandidate,
  contactKeys,
} from "../../../src/server/candidates/crypto.ts";
import { selectApplicationPage } from "../../../src/server/applications/service.ts";
import { applicationSearch } from "../../../src/server/applications/contract.ts";

describe("Batched candidate matching (isolated PostgreSQL)", () => {
  let db;
  let saved;
  let phoneSequence = 1000000;
  before(async () => {
    saved = Object.fromEntries(
      [
        "CANDIDATE_ENCRYPTION_KEYS",
        "CANDIDATE_MATCH_KEYS",
        "CANDIDATE_ACTIVE_KEY_VERSION",
      ].map((key) => [key, process.env[key]]),
    );
    process.env.CANDIDATE_ENCRYPTION_KEYS = JSON.stringify({
      1: randomBytes(32).toString("base64"),
      2: randomBytes(32).toString("base64"),
    });
    process.env.CANDIDATE_MATCH_KEYS = JSON.stringify({
      1: randomBytes(32).toString("base64"),
      2: randomBytes(32).toString("base64"),
    });
    process.env.CANDIDATE_ACTIVE_KEY_VERSION = "2";
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal;
      CREATE TABLE portal.candidates (
        id uuid PRIMARY KEY,merged_into_id uuid,
        name_encrypted bytea,email_encrypted bytea,phone_encrypted bytea,
        email_hmac bytea,phone_hmac bytea,hmac_key_version integer,
        version integer DEFAULT 1,blocked boolean DEFAULT false
      );
      CREATE INDEX candidates_merged_into_idx ON portal.candidates(merged_into_id);
      CREATE INDEX candidates_email_idx ON portal.candidates(email_hmac,hmac_key_version);
      CREATE INDEX candidates_phone_idx ON portal.candidates(phone_hmac,hmac_key_version);
      CREATE SCHEMA portal_private;
      CREATE FUNCTION portal_private.candidate_group_blocked(p_id uuid) RETURNS boolean
        LANGUAGE SQL STABLE AS $$ SELECT coalesce((SELECT blocked FROM portal.candidates WHERE id=p_id),true) $$;
      CREATE TABLE portal.jobs(id uuid PRIMARY KEY,draft_content jsonb);
      CREATE TABLE portal.uploads(id uuid PRIMARY KEY,scan_state text,access_revoked_at timestamptz);
      CREATE TABLE portal.applications(
        id uuid PRIMARY KEY,job_id uuid,candidate_id uuid,cv_upload_id uuid,
        intake_state text,status text,source text,submitted_at timestamptz,
        consent_at timestamptz,policy_version text,version integer DEFAULT 1,
        cv_scan_state text,duplicate_candidate_match boolean DEFAULT false
      );
    `);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261027000200_candidate_group_index/migration.sql",
        "utf8",
      ),
    );
  });
  after(async () => {
    await db?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(async () => db.exec("BEGIN"));
  afterEach(async () => db.exec("ROLLBACK"));

  async function candidate(email, version = "2", root = null) {
    const id = randomUUID();
    process.env.CANDIDATE_ACTIVE_KEY_VERSION = version;
    const encrypted = encryptedCandidate(id, {
      name: "Synthetic",
      email,
      phone: `+25078${phoneSequence++}`,
    });
    await db.query(
      `INSERT INTO portal.candidates VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        root,
        encrypted.nameEncrypted,
        encrypted.emailEncrypted,
        encrypted.phoneEncrypted,
        encrypted.emailHmac,
        encrypted.phoneHmac,
        encrypted.hmacKeyVersion,
      ],
    );
    return id;
  }
  function tracked() {
    const calls = [];
    return {
      calls,
      async query(sql, values) {
        calls.push({ sql, values });
        const result = await db.query(sql, values);
        // Match node-postgres bytea decoding at the production adapter boundary.
        return {
          ...result,
          rows: result.rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof Uint8Array ? Buffer.from(value) : value,
              ]),
            ),
          ),
        };
      },
    };
  }

  test("repeated applications share a batched lookup across aliases and key versions", async () => {
    const root = await candidate("root@example.invalid");
    await candidate("old@example.invalid", "1", root);
    await candidate("old@example.invalid", "2");
    const rows = Array.from({ length: 20 }, () => ({
      candidate_id: root,
      blocked: false,
      live_duplicate: false,
    }));
    const query = tracked();
    await applicationMatchFlags(query, rows);
    assert.ok(rows.every((row) => row.live_duplicate));
    assert.equal(query.calls.length, 2);
    assert.deepEqual(query.calls[0].values, [[root]]);
    assert.ok(
      query.calls.every((call) => !call.sql.includes("SELECT root.id")),
    );
  });

  test("aliases of the same canonical candidate are not duplicates", async () => {
    const root = await candidate("root@example.invalid");
    await candidate("root@example.invalid", "1", root);
    const rows = [{ candidate_id: root, blocked: false, live_duplicate: true }];
    await applicationMatchFlags(tracked(), rows);
    assert.equal(rows[0].live_duplicate, false);
  });

  test("unreadable profiles retain the same-version fallback once per root", async () => {
    const root = await candidate("root@example.invalid");
    await candidate("root@example.invalid");
    const encryption = process.env.CANDIDATE_ENCRYPTION_KEYS;
    process.env.CANDIDATE_ENCRYPTION_KEYS = "{}";
    try {
      const rows = Array.from({ length: 20 }, () => ({
        candidate_id: root,
        blocked: false,
        live_duplicate: false,
      }));
      const query = tracked();
      await applicationMatchFlags(query, rows);
      assert.ok(rows.every((row) => row.live_duplicate));
      assert.equal(query.calls.length, 2);
      assert.deepEqual(query.calls[1].values, [[root]]);
    } finally {
      process.env.CANDIDATE_ENCRYPTION_KEYS = encryption;
    }
  });

  test("missing matching keys use the fallback and blocked profiles trigger no lookups", async () => {
    const root = await candidate("root@example.invalid");
    await candidate("root@example.invalid");
    const matching = process.env.CANDIDATE_MATCH_KEYS;
    process.env.CANDIDATE_MATCH_KEYS = "{}";
    try {
      const rows = [
        { candidate_id: root, blocked: false, live_duplicate: false },
      ];
      await applicationMatchFlags(tracked(), rows);
      assert.equal(rows[0].live_duplicate, true);
      const query = tracked();
      await applicationMatchFlags(query, [
        { candidate_id: root, blocked: true },
      ]);
      assert.equal(query.calls.length, 0);
    } finally {
      process.env.CANDIDATE_MATCH_KEYS = matching;
    }
  });

  test("the group expression index supports page-sized root lookups", async () => {
    const root = await candidate("root@example.invalid");
    await candidate("alias@example.invalid", "1", root);
    await db.exec(`INSERT INTO portal.candidates(id,hmac_key_version)
      SELECT gen_random_uuid(),2 FROM generate_series(1,5000);
      ANALYZE portal.candidates;`);
    const sql =
      "SELECT id FROM portal.candidates WHERE coalesce(merged_into_id,id)=ANY($1::uuid[])";
    assert.equal((await db.query(sql, [[root]])).rows.length, 2);
    const plan = await db.query(`EXPLAIN (FORMAT JSON) ${sql}`, [[root]]);
    assert.ok(JSON.stringify(plan.rows).includes("candidates_group_idx"));
  });

  test("candidate matching returns totals and even an empty page in one statement", async () => {
    const root = await candidate("matched@example.invalid");
    await candidate("matched@example.invalid");
    const query = tracked();
    const page = await findContactMatches(
      query,
      contactKeys("matched@example.invalid"),
      root,
      1,
      1,
    );
    assert.equal(page.total, 1);
    assert.equal(page.matches.length, 1);
    assert.equal(page.matches[0].reason, "email");
    assert.equal(query.calls.length, 1);
    const empty = await findContactMatches(
      tracked(),
      contactKeys("matched@example.invalid"),
      root,
      2,
      1,
    );
    assert.equal(empty.total, 1);
    assert.deepEqual(empty.matches, []);
  });

  test("application counts and rows share one statement, including empty filtered pages", async () => {
    const root = await candidate("application@example.invalid");
    const jobId = randomUUID(),
      uploadId = randomUUID();
    await db.query("INSERT INTO portal.jobs VALUES($1,$2)", [
      jobId,
      JSON.stringify({ en: { title: "Fixture" }, zh: { title: "Fixture" } }),
    ]);
    await db.query("INSERT INTO portal.uploads VALUES($1,'UNSCANNED',NULL)", [
      uploadId,
    ]);
    for (const [status, state] of [
      ["NEW", "CONFIRMED"],
      ["OFFER", "CONFIRMED"],
      ["NEW", "RECEIVED"],
    ]) {
      await db.query(
        `INSERT INTO portal.applications(id,job_id,candidate_id,cv_upload_id,intake_state,status,source,submitted_at,consent_at,policy_version,cv_scan_state)
        VALUES($1,$2,$3,$4,$5,$6,'CAREERS',now(),now(),'fixture','UNSCANNED')`,
        [randomUUID(), jobId, root, uploadId, state, status],
      );
    }
    const query = tracked();
    const page = await selectApplicationPage(
      query,
      applicationSearch.parse({ status: ["NEW"] }),
    );
    assert.equal(page.total, 1);
    assert.equal(page.counts.NEW, 1);
    assert.equal(page.counts.OFFER, 1);
    assert.equal(page.applications.length, 1);
    assert.equal(page.applications[0].cvAvailable, true);
    assert.equal(page.applications[0].profileAvailable, true);
    assert.equal(
      query.calls.filter((call) => call.sql.includes("portal.applications"))
        .length,
      1,
    );
    const empty = await selectApplicationPage(
      tracked(),
      applicationSearch.parse({ status: ["REJECTED"] }),
    );
    assert.equal(empty.total, 0);
    assert.equal(empty.counts.NEW, 1);
    assert.deepEqual(empty.applications, []);
    await db.query("UPDATE portal.candidates SET blocked=true WHERE id=$1", [
      root,
    ]);
    const blocked = await selectApplicationPage(
      tracked(),
      applicationSearch.parse({ status: ["NEW"] }),
    );
    assert.equal(blocked.applications[0].cvAvailable, false);
    assert.equal(blocked.applications[0].profileAvailable, false);
  });
});
