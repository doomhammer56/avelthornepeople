import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

const migration = new URL(
  "../../../prisma/migrations/20261019000100_rls_query_boundaries/migration.sql",
  import.meta.url,
);

test(
  "Public and staff database boundaries",
  { timeout: 300_000 },
  async (t) => {
    assert.ok(
      process.env.DIRECT_URL,
      "Use the dedicated Supabase test database.",
    );
    const db = new pg.Client({
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 15_000,
      statement_timeout: 15_000,
    });
    await db.connect();
    t.after(async () => {
      try {
        await db.query("ROLLBACK");
      } finally {
        await db.end();
      }
    });
    await db.query("BEGIN");
    // Preview the exact pending SQL without recording or committing a migration.
    // Normal test runs require deployment, like the other database suites.
    if (process.env.DB_RLS_PREVIEW === "1") {
      const sql = readFileSync(migration, "utf8")
        .replace(/^BEGIN;\s*/, "")
        .replace(/COMMIT;\s*$/, "");
      await db.query(sql);
    }

    // Supabase's migration role is not a superuser and cannot SET ROLE merely
    // because it created a capability role. Test membership is transactional
    // and is always rolled back with the fixtures, never provisioned for apps.
    await db.query(
      "GRANT portal_public_reader, portal_public_view_owner, portal_runtime TO CURRENT_USER",
    );

    const staffId = await createStaffFixture(db);
    const prefix = `db02-${randomUUID()}`;
    const department = (
      await db.query(
        "INSERT INTO portal.departments (code, name_zh) VALUES ($1, 'Test department') RETURNING id",
        [prefix],
      )
    ).rows[0].id;
    const location = (
      await db.query(
        "INSERT INTO portal.locations (code, name_zh, country_code, timezone) VALUES ($1, 'Test office', 'RW', 'Africa/Kigali') RETURNING id",
        [prefix],
      )
    ).rows[0].id;
    const draft = { zh: { title: "PRIVATE DRAFT CANARY" } };
    const published = { zh: { title: "Approved public job" } };
    const jobs = {};
    for (const state of [
      "visible",
      "salary",
      "draft",
      "pending",
      "paused",
      "closed",
      "future",
      "expired",
      "boundary",
    ]) {
      const row = (
        await db.query(
          "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, $2::jsonb, $3) RETURNING id",
          [`${prefix}-${state}`, JSON.stringify(draft), staffId],
        )
      ).rows[0];
      jobs[state] = row.id;
      if (state !== "draft") {
        const status =
          { pending: "PENDING_REVIEW", paused: "PAUSED", closed: "CLOSED" }[
            state
          ] ?? "PUBLISHED";
        await db.query(
          `UPDATE portal.jobs SET status = $2, published_content = $3::jsonb,
         published_version = 1, approved_by = $4, approved_at = now(),
         department_id = $5, job_type = 'FULL_TIME', experience = 'MID',
         publish_at = statement_timestamp() + $6::interval,
         close_at = statement_timestamp() + $7::interval,
         salary_min = 100, salary_max = 200, salary_currency = 'USD',
         salary_period = 'MONTH', show_salary = $8 WHERE id = $1`,
          [
            row.id,
            status,
            JSON.stringify(published),
            staffId,
            department,
            state === "future" ? "1 day" : "-2 days",
            state === "expired"
              ? "-1 day"
              : state === "boundary"
                ? "0 seconds"
                : "2 days",
            state === "salary",
          ],
        );
      }
      await db.query(
        "INSERT INTO portal.job_locations (job_id, location_id) VALUES ($1, $2)",
        [row.id, location],
      );
    }
    const contentIds = [];
    for (const state of ["draft", "published", "future"]) {
      const row = (
        await db.query(
          "INSERT INTO portal.content_blocks (type, draft_content) VALUES ('BANNER', $1::jsonb) RETURNING id",
          [JSON.stringify(draft)],
        )
      ).rows[0];
      contentIds.push(row.id);
      if (state !== "draft") {
        await db.query(
          "UPDATE portal.content_blocks SET published_content = $2::jsonb, published_by = $3, published_at = statement_timestamp() + $4::interval WHERE id = $1",
          [
            row.id,
            JSON.stringify(published),
            staffId,
            state === "future" ? "1 day" : "-1 day",
          ],
        );
      }
    }
    const candidate = (
      await db.query(
        "INSERT INTO portal.candidates (name_encrypted, email_encrypted, phone_encrypted, email_hmac, phone_hmac, hmac_key_version) VALUES ($1, $1, $1, $2, $3, 1) RETURNING id",
        [randomBytes(48), randomBytes(32), randomBytes(32)],
      )
    ).rows[0].id;
    const uploadIds = [];
    const applicationIds = [];
    for (const confirmed of [true, false]) {
      const upload = (
        await db.query(
          "INSERT INTO portal.uploads (storage_provider, bucket, object_key, declared_size_bytes, capability_hash, capability_expires_at) VALUES ('SUPABASE', 'db02-test', $1, 128, $2, now() + interval '1 day') RETURNING id",
          [randomUUID(), randomBytes(32)],
        )
      ).rows[0].id;
      uploadIds.push(upload);
      const application = (
        await db.query(
          "INSERT INTO portal.applications (job_id, cv_upload_id, profile_encrypted, consent_at, policy_version, source, locale, idempotency_key, payload_digest, receipt_hash, receipt_expires_at) VALUES ($1, $2, $3, now(), 'v1', 'CAREERS', 'en', $4, $5, $6, now() + interval '1 day') RETURNING id",
          [
            jobs.visible,
            upload,
            randomBytes(48),
            randomUUID(),
            randomBytes(32),
            randomBytes(32),
          ],
        )
      ).rows[0].id;
      applicationIds.push(application);
      if (confirmed) {
        await db.query(
          "UPDATE portal.uploads SET scan_state = 'CLEAN', size_bytes = declared_size_bytes, sha256 = $2, detected_type = 'application/pdf', scanned_at = now() WHERE id = $1",
          [upload, randomBytes(32)],
        );
        await db.query(
          "UPDATE portal.applications SET candidate_id = $2, cv_scan_state = 'CLEAN', intake_state = 'CONFIRMED', confirmed_at = now() WHERE id = $1",
          [application, candidate],
        );
      }
    }
    const message = (
      await db.query(
        "INSERT INTO portal.contact_messages (sender_encrypted, body_encrypted, locale) VALUES ($1, $1, 'en') RETURNING id",
        [randomBytes(48)],
      )
    ).rows[0].id;
    const audit = (
      await db.query(
        "INSERT INTO portal.audit_logs (actor_id, object_type, object_id, action, request_id) VALUES ($1, 'JOB', $2, 'UPDATED', $3) RETURNING id",
        [staffId, jobs.visible, randomUUID()],
      )
    ).rows[0].id;
    const deletion = (
      await db.query(
        "INSERT INTO portal.deletion_requests (candidate_id, verified_requester_ref, reason_code, due_at) VALUES ($1, $2, 'ERASURE', now() + interval '30 days') RETURNING id",
        [candidate, randomUUID()],
      )
    ).rows[0].id;

    async function staff(role, active = true) {
      await db.query(
        "UPDATE portal.staff_profiles SET role = $2, active = $3 WHERE id = $1",
        [staffId, role, active],
      );
    }

    async function asRole(role, subject, callback, metadata = {}) {
      assert.ok(
        [
          "anon",
          "authenticated",
          "service_role",
          "portal_public_reader",
          "portal_public_view_owner",
          "portal_runtime",
        ].includes(role),
      );
      await db.query("SAVEPOINT impersonation");
      try {
        await db.query(
          "SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
          [
            subject ?? "",
            JSON.stringify({
              sub: subject,
              role: "authenticated",
              user_metadata: metadata,
            }),
          ],
        );
        await db.query(`SET LOCAL ROLE ${role}`);
        await callback();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT impersonation");
        await db.query("RELEASE SAVEPOINT impersonation");
      }
    }

    async function ids(table, wanted) {
      assert.match(table, /^[a-z_]+$/);
      return (
        await db.query(
          `SELECT id FROM portal.${table} WHERE id = ANY($1::uuid[])`,
          [wanted],
        )
      ).rows.map((row) => row.id);
    }

    await t.test(
      "public discovery exposes only due approved rows and safe columns",
      async () => {
        for (const role of [
          "portal_public_reader",
          "portal_public_view_owner",
        ]) {
          await asRole(role, null, async () => {
            const rows = (
              await db.query(
                "SELECT * FROM portal.visible_jobs WHERE id = ANY($1::uuid[]) ORDER BY canonical_slug",
                [Object.values(jobs)],
              )
            ).rows;
            assert.deepEqual(
              new Set(rows.map((row) => row.id)),
              new Set([jobs.visible, jobs.salary]),
            );
            const hiddenSalary = rows.find((row) => row.id === jobs.visible);
            assert.deepEqual(hiddenSalary.published_content, published);
            for (const key of [
              "salary_min",
              "salary_max",
              "salary_currency",
              "salary_period",
            ]) {
              assert.equal(hiddenSalary[key], null, key);
            }
            assert.equal(
              rows.find((row) => row.id === jobs.salary).salary_min,
              "100.00",
            );
            assert.ok(!JSON.stringify(rows).includes("PRIVATE DRAFT CANARY"));
            for (const key of [
              "draft_content",
              "owner_id",
              "approved_by",
              "version",
            ]) {
              assert.ok(!(key in hiddenSalary), key);
            }
            assert.deepEqual(await ids("published_content", contentIds), [
              contentIds[1],
            ]);
            const assignments = await db.query(
              "SELECT job_id FROM portal.visible_job_locations WHERE job_id = ANY($1::uuid[])",
              [Object.values(jobs)],
            );
            assert.deepEqual(
              new Set(assignments.rows.map((row) => row.job_id)),
              new Set([jobs.visible, jobs.salary]),
            );
          });
        }
      },
    );

    await t.test(
      "active lookup filters apply to views and assignments",
      async () => {
        await db.query("SAVEPOINT inactive_lookup");
        try {
          await db.query(
            "UPDATE portal.locations SET active = false WHERE id = $1",
            [location],
          );
          await db.query(
            "UPDATE portal.departments SET active = false WHERE id = $1",
            [department],
          );
          await asRole("portal_public_reader", null, async () => {
            assert.deepEqual(await ids("public_locations", [location]), []);
            assert.deepEqual(await ids("public_departments", [department]), []);
            assert.deepEqual(
              (
                await db.query(
                  "SELECT 1 FROM portal.visible_job_locations WHERE location_id = $1",
                  [location],
                )
              ).rows,
              [],
            );
          });
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT inactive_lookup");
          await db.query("RELEASE SAVEPOINT inactive_lookup");
        }
      },
    );

    await t.test(
      "public reader cannot access private columns/tables or write views",
      async () => {
        await asRole("portal_public_reader", null, async () => {
          for (const table of [
            "jobs",
            "staff_profiles",
            "candidates",
            "applications",
            "uploads",
            "contact_messages",
            "audit_logs",
            "outbox_events",
            "deletion_requests",
          ]) {
            await expectQueryError(
              db,
              `SELECT * FROM portal.${table}`,
              [],
              "42501",
            );
          }
          await expectQueryError(
            db,
            "SELECT draft_content FROM portal.visible_jobs",
            [],
            "42703",
          );
          await expectQueryError(
            db,
            "UPDATE portal.visible_jobs SET canonical_slug = 'tampered' WHERE id = $1",
            [jobs.visible],
            "42501",
          );
          await expectQueryError(
            db,
            "SELECT portal_private.current_staff_role()",
            [],
            "42501",
          );
        });
      },
    );

    await t.test(
      "provider roles have no direct application access, even with a staff JWT",
      async () => {
        await staff("ADMIN");
        for (const role of ["anon", "authenticated", "service_role"]) {
          await asRole(role, staffId, async () => {
            for (const table of [
              "jobs",
              "candidates",
              "staff_profiles",
              "audit_logs",
              "visible_jobs",
            ]) {
              await expectQueryError(
                db,
                `SELECT * FROM portal.${table}`,
                [],
                "42501",
              );
            }
            await expectQueryError(
              db,
              "SELECT portal_private.current_staff_role()",
              [],
              "42501",
            );
          });
        }
      },
    );

    await t.test(
      "missing/inactive staff and forged metadata fail closed",
      async () => {
        for (const subject of [null, randomUUID(), staffId]) {
          await staff("ADMIN", false);
          await asRole(
            "portal_runtime",
            subject,
            async () => {
              assert.equal(
                (
                  await db.query(
                    "SELECT portal_private.current_staff_role() AS role",
                  )
                ).rows[0].role,
                null,
              );
              for (const [table, wanted] of [
                ["jobs", [jobs.draft]],
                ["candidates", [candidate]],
                ["applications", applicationIds],
                ["staff_profiles", [staffId]],
              ]) {
                assert.deepEqual(await ids(table, wanted), []);
              }
              await expectQueryError(
                db,
                "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $2)",
                [`${prefix}-forged`, staffId],
                "42501",
              );
            },
            { role: "ADMIN", active: true },
          );
        }
      },
    );

    await t.test(
      "READ_ONLY inspects jobs/content/metrics without PII or writes",
      async () => {
        await staff("READ_ONLY");
        await asRole(
          "portal_runtime",
          staffId,
          async () => {
            assert.deepEqual(await ids("jobs", [jobs.draft]), [jobs.draft]);
            assert.deepEqual(await ids("content_blocks", [contentIds[0]]), [
              contentIds[0],
            ]);
            await db.query("SELECT * FROM portal.daily_metrics LIMIT 0");
            assert.deepEqual(await ids("staff_profiles", [staffId]), [staffId]);
            for (const [table, wanted] of [
              ["candidates", [candidate]],
              ["applications", applicationIds],
              ["uploads", uploadIds],
              ["contact_messages", [message]],
              ["audit_logs", [audit]],
              ["deletion_requests", [deletion]],
            ])
              assert.deepEqual(await ids(table, wanted), []);
            await expectQueryError(
              db,
              "UPDATE portal.jobs SET draft_content = '{}'::jsonb WHERE id = $1",
              [jobs.draft],
              "42501",
            );
            await expectQueryError(
              db,
              "UPDATE portal.applications SET status = 'OFFER' WHERE id = $1",
              [applicationIds[0]],
              "42501",
            );
            await expectQueryError(
              db,
              "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $2)",
              [`${prefix}-readonly`, staffId],
              "42501",
            );
          },
          { role: "ADMIN" },
        );
      },
    );

    await t.test(
      "HR reads confirmed applications and their clean CVs only",
      async () => {
        await staff("HR");
        await asRole("portal_runtime", staffId, async () => {
          assert.deepEqual(await ids("candidates", [candidate]), [candidate]);
          assert.deepEqual(await ids("applications", applicationIds), [
            applicationIds[0],
          ]);
          assert.deepEqual(await ids("uploads", uploadIds), [uploadIds[0]]);
          assert.deepEqual(await ids("contact_messages", [message]), [message]);
          assert.deepEqual(await ids("audit_logs", [audit]), []);
          assert.deepEqual(await ids("deletion_requests", [deletion]), []);
          await expectQueryError(
            db,
            "UPDATE portal.applications SET status = 'SCREENING', version = version + 1 WHERE id = $1 RETURNING status",
            [applicationIds[0]],
            "42501",
          );
          await expectQueryError(
            db,
            "UPDATE portal.applications SET status = 'SCREENING' WHERE id = $1",
            [applicationIds[1]],
            "42501",
          );
          assert.equal(
            (
              await db.query(
                "UPDATE portal.contact_messages SET state = 'IN_PROGRESS', assigned_to = $2 WHERE id = $1",
                [message, staffId],
              )
            ).rowCount,
            1,
          );
        });
      },
    );

    await t.test(
      "HR must use audited job commands and cannot directly self-approve",
      async () => {
        await staff("HR");
        await asRole("portal_runtime", staffId, async () => {
          await expectQueryError(
            db,
            "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $2)",
            [prefix + "-hr-created", staffId],
            "42501",
          );
          await expectQueryError(
            db,
            "UPDATE portal.jobs SET draft_content = '{}'::jsonb,version=version+1 WHERE id=$1",
            [jobs.visible],
            "42501",
          );
          for (const assignment of [
            "status = 'PUBLISHED'",
            "published_content = '{}'::jsonb",
            "approved_by = owner_id",
            "publish_at = now()",
            "salary_min = 999",
            "department_id = NULL",
            "owner_id = owner_id",
          ])
            await expectQueryError(
              db,
              `UPDATE portal.jobs SET ${assignment} WHERE id = $1`,
              [jobs.visible],
              "42501",
            );
          await expectQueryError(
            db,
            "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id, status) VALUES ($1, '{}'::jsonb, $2, 'PUBLISHED')",
            [`${prefix}-publish-insert`, staffId],
            "42501",
          );
          await expectQueryError(
            db,
            "INSERT INTO portal.job_locations (job_id, location_id) VALUES ($1, $2)",
            [jobs.visible, location],
            "42501",
          );
        });
      },
    );

    await t.test(
      "HR cannot manage company content, accounts or operational state",
      async () => {
        await staff("HR");
        await asRole("portal_runtime", staffId, async () => {
          await expectQueryError(
            db,
            "UPDATE portal.content_blocks SET draft_content = '{}'::jsonb WHERE id = $1",
            [contentIds[0]],
            "42501",
          );
          await expectQueryError(
            db,
            "INSERT INTO portal.departments (code, name_zh) VALUES ($1, 'Denied')",
            [prefix + "-hr"],
            "42501",
          );
          for (const sql of [
            "UPDATE portal.staff_profiles SET role = 'ADMIN', active = true",
            "INSERT INTO portal.staff_profiles (id, display_name) VALUES (gen_random_uuid(), 'Denied')",
            "UPDATE portal.audit_logs SET action = 'TAMPERED'",
            "DELETE FROM portal.audit_logs",
            "TRUNCATE portal.audit_logs",
            "SELECT * FROM portal.outbox_events",
            "UPDATE portal.outbox_events SET attempts = 0",
            "UPDATE portal.uploads SET scan_state = 'CLEAN'",
            "UPDATE portal.applications SET intake_state = 'CONFIRMED'",
            "DELETE FROM portal.candidates",
            "CREATE TABLE portal.untrusted (id uuid)",
          ])
            await expectQueryError(db, sql, [], "42501");
        });
      },
    );

    await t.test(
      "ADMIN inspects restricted data and uses audited commands for company content",
      async () => {
        await staff("ADMIN");
        await asRole("portal_runtime", staffId, async () => {
          assert.deepEqual(await ids("audit_logs", [audit]), [audit]);
          assert.deepEqual(await ids("deletion_requests", [deletion]), [
            deletion,
          ]);
          for (const table of ["departments", "locations"])
            await expectQueryError(
              db,
              `UPDATE portal.${table} SET name_en='Updated' WHERE id=$1`,
              [table === "departments" ? department : location],
              "42501",
            );
          await expectQueryError(
            db,
            "UPDATE portal.content_blocks SET draft_content = '{}'::jsonb WHERE id = $1",
            [contentIds[0]],
            "42501",
          );
          await expectQueryError(
            db,
            "UPDATE portal.content_blocks SET published_content = '{}'::jsonb WHERE id = $1",
            [contentIds[0]],
            "42501",
          );
          await expectQueryError(
            db,
            "UPDATE portal.staff_profiles SET active = true",
            [],
            "42501",
          );
          await expectQueryError(
            db,
            "DELETE FROM portal.audit_logs",
            [],
            "42501",
          );
        });
      },
    );

    await t.test(
      "role changes and deactivation apply to the next statement",
      async () => {
        await staff("HR");
        await asRole("portal_runtime", staffId, async () => {
          assert.deepEqual(await ids("candidates", [candidate]), [candidate]);
          // Switch back to the migration connection only to simulate an authorized
          // offboarding action; return to exactly the same pooled runtime session.
          await db.query("RESET ROLE");
          await staff("READ_ONLY");
          await db.query("SET LOCAL ROLE portal_runtime");
          assert.deepEqual(await ids("candidates", [candidate]), []);
          await db.query("RESET ROLE");
          await staff("ADMIN", false);
          await db.query("SET LOCAL ROLE portal_runtime");
          assert.deepEqual(await ids("jobs", [jobs.draft]), []);
        });
      },
    );

    await t.test(
      "local claims and roles do not survive transaction boundaries on a pooled connection",
      async () => {
        // This separate pool commits session configuration only, never fixtures.
        // The new role may be uncommitted in preview mode, so test with the
        // existing authenticated role; SET LOCAL has the same lifetime semantics.
        const pool = new pg.Pool({
          connectionString: process.env.DIRECT_URL,
          max: 1,
          connectionTimeoutMillis: 15_000,
          statement_timeout: 15_000,
        });
        let first;
        let second;
        try {
          first = await pool.connect();
          await first.query("BEGIN");
          const pid = (await first.query("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid;
          await first.query("SET LOCAL ROLE authenticated");
          await first.query(
            "SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
            [staffId, JSON.stringify({ sub: staffId })],
          );
          assert.equal(
            (await first.query("SELECT auth.uid() AS id")).rows[0].id,
            staffId,
          );
          await first.query("COMMIT");
          first.release();
          first = null;

          second = await pool.connect();
          await second.query("BEGIN");
          const reset = (
            await second.query(
              "SELECT pg_backend_pid() AS pid, auth.uid() AS id, current_user = session_user AS role_reset",
            )
          ).rows[0];
          assert.equal(reset.pid, pid);
          assert.equal(reset.id, null);
          assert.equal(reset.role_reset, true);
          await second.query("ROLLBACK");
        } finally {
          for (const client of [first, second]) {
            if (client) {
              await client.query("ROLLBACK");
              client.release();
            }
          }
          await pool.end();
        }
      },
    );

    await t.test(
      "roles cannot bypass RLS or inherit each other's capabilities",
      async () => {
        const roles = (
          await db.query(
            "SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname IN ('portal_public_reader', 'portal_public_view_owner', 'portal_runtime')",
          )
        ).rows;
        assert.equal(roles.length, 3);
        assert.ok(
          roles.every(
            (role) =>
              !role.rolcanlogin &&
              !role.rolsuper &&
              !role.rolcreaterole &&
              !role.rolcreatedb &&
              !role.rolbypassrls,
          ),
        );
        const memberships = (
          await db.query(
            "SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE member.rolname IN ('anon','authenticated','service_role','portal_public_reader','portal_runtime') AND parent.rolname IN ('portal_public_reader','portal_public_view_owner','portal_runtime')",
          )
        ).rows;
        assert.deepEqual(memberships, []);
        const views = (
          await db.query(
            "SELECT c.relname, r.rolname AS owner, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'portal' AND c.relkind = 'v'",
          )
        ).rows;
        assert.deepEqual(
          new Set(views.map((view) => view.relname)),
          new Set([
            "visible_jobs",
            "published_content",
            "public_departments",
            "public_locations",
            "visible_job_locations",
            "company_content",
            "published_content_images",
          ]),
        );
        assert.ok(
          views.every(
            (view) =>
              view.owner === "portal_public_view_owner" &&
              view.reloptions.includes("security_barrier=true"),
          ),
        );
        // SET ROLE from an owner connection checks session_user, so use the
        // target role's actual membership privileges rather than impersonating
        // the privileged connection and expecting SET ROLE to be denied.
        assert.deepEqual(
          (
            await db.query(
              "SELECT pg_has_role('portal_public_reader', 'portal_runtime', 'MEMBER') AS allowed, pg_has_role('portal_runtime', 'portal_public_view_owner', 'MEMBER') AS owner_access",
            )
          ).rows,
          [{ allowed: false, owner_access: false }],
        );
      },
    );
  },
);
