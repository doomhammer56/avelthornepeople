import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { seedOptions, seedEnvironment } from "./options.mjs";
import {
  businessTables,
  resetBusinessData,
  seedVacancies,
} from "./database.mjs";
import { vacancies } from "./data.mjs";
import { authAdminClient } from "../../src/server/adapters/auth/admin.ts";

let db, journal, journalPath;
const saveJournal = () =>
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", {
    mode: 0o600,
  });
async function cleanupProviderUsers(provider) {
  if (!journal.committed)
    throw new Error("Cleanup refused: database commit has not been confirmed.");
  const ids = z.array(z.uuid()).max(1000).parse(journal.pendingAuthDeletes);
  // Validate the whole list before the first deletion. No linked account may go.
  if (
    (
      await db.query(
        "SELECT id FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
        [ids],
      )
    ).rowCount
  )
    throw new Error(
      "Cleanup refused: a listed identity is still linked to a staff profile.",
    );
  for (const id of ids) {
    const result = await provider.auth.admin.deleteUser(id);
    if (result.error && result.error.status !== 404)
      throw new Error(
        "Provider cleanup is incomplete. Retry using --cleanup-file and the saved journal.",
      );
    journal.pendingAuthDeletes = journal.pendingAuthDeletes.filter(
      (value) => value !== id,
    );
    saveJournal();
  }
}

try {
  const options = seedOptions();
  const project = seedEnvironment(options["env-file"], options.project);
  db = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  await db.connect();
  if (
    !(await db.query("SELECT pg_try_advisory_lock(7608,1) AS locked")).rows[0]
      .locked
  )
    throw new Error("Another seed command is running for this database.");
  const provider = authAdminClient();
  console.log(`Seed target: ${project}.supabase.co (${options["env-file"]})`);
  if (options["cleanup-file"]) {
    journalPath = options["cleanup-file"];
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
    if (journal.format !== 1 || journal.project !== project)
      throw new Error("Cleanup journal does not match this project.");
    if (options.apply) await cleanupProviderUsers(provider);
    console.log(
      `Pending old staff identity deletions: ${journal.pendingAuthDeletes.length}. ${options.apply ? "Cleanup complete." : "Preview only."}`,
    );
  } else {
    const admins = (
      await db.query(
        "SELECT id,role,active,version FROM portal.staff_profiles WHERE role='ADMIN' ORDER BY created_at,id",
      )
    ).rows;
    const actor = admins.find(
      (row) =>
        row.active && (!options["admin-id"] || row.id === options["admin-id"]),
    );
    if (!actor)
      throw new Error(
        "No selected active Admin. Use auth:bootstrap before seeding an empty project.",
      );
    const verified = await provider.auth.admin.getUserById(actor.id);
    if (
      verified.error ||
      !verified.data.user ||
      (verified.data.user.banned_until &&
        Date.parse(verified.data.user.banned_until) > Date.now())
    )
      throw new Error(
        "The selected Admin must have an available, unbanned Auth identity.",
      );
    const counts = {};
    for (const table of businessTables)
      counts[table] = Number(
        (await db.query(`SELECT count(*) AS n FROM portal.${table}`)).rows[0].n,
      );
    console.log(
      `Preserving ${admins.length} Admin account(s), including passwords and existing session admissions.`,
    );
    console.log(
      `${options.reset ? "Reset then seed" : "Add missing seed records"}: ${JSON.stringify(counts)}`,
    );
    if (options.reset && (counts.uploads || counts.content_images))
      throw new Error(
        "Reset refused: clean up attached CV/content files through Storage first. No data changed.",
      );
    const accounts = [];
    if (options["with-staff"]) {
      for (const [name, role, displayName] of [
        ["hr", "HR", "HR Manager"],
        ["readonly", "READ_ONLY", "Read-Only Reviewer"],
      ]) {
        const email = `${name}@${options["staff-domain"]}`.toLowerCase();
        const row = (
          await db.query(
            "SELECT u.id,p.role,p.active FROM auth.users u LEFT JOIN portal.staff_profiles p ON p.id=u.id WHERE lower(u.email)=$1",
            [email],
          )
        ).rows[0];
        if (row?.role && (row.role !== role || !row.active))
          throw new Error(
            "An existing seed email has different access. Review it in Accounts before seeding.",
          );
        if (row) {
          const user = await provider.auth.admin.getUserById(row.id);
          const pending = (
            await db.query(
              "SELECT EXISTS(SELECT 1 FROM portal_private.staff_provider_operations WHERE profile_id=$1 AND completed_at IS NULL) AS pending",
              [row.id],
            )
          ).rows[0].pending;
          if (
            user.error ||
            pending ||
            (user.data.user?.banned_until &&
              Date.parse(user.data.user.banned_until) > Date.now())
          )
            throw new Error(
              "An existing seed account needs provider reconciliation before seeding.",
            );
        }
        accounts.push({ email, role, displayName, userId: row?.id ?? null });
        console.log(
          `${role}: ${email} (${row ? "preserve existing password" : "create new identity"})`,
        );
      }
    }
    const keepIds = accounts.flatMap((a) => (a.userId ? [a.userId] : []));
    const removed = options.reset
      ? (
          await db.query(
            "SELECT id FROM portal.staff_profiles WHERE role<>'ADMIN' AND NOT(id=ANY($1::uuid[])) ORDER BY id",
            [keepIds],
          )
        ).rows.map((r) => r.id)
      : [];
    console.log(
      `Old non-Admin staff identities to remove: ${removed.length}. Vacancies: ${vacancies.length}. Company sections: 6.`,
    );
    for (const vacancy of vacancies) console.log(`  ${vacancy.en.title}`);
    if (!options.apply)
      console.log(
        "Preview only. Run db:seed with the same environment/options to apply. Reset and cleanup also require --project <reference>.",
      );
    else {
      let sharedPassword;
      if (options["staff-password-file"]) {
        sharedPassword = readFileSync(
          options["staff-password-file"],
          "utf8",
        ).replace(/\r?\n$/, "");
        if (sharedPassword.length < 12 || sharedPassword.length > 128)
          throw new Error("Staff password must contain 12–128 characters.");
      }
      journalPath = `.env.seed-${project}-${randomUUID()}.json`;
      journal = {
        format: 1,
        project,
        committed: false,
        pendingAuthDeletes: removed,
        accounts: accounts.map((a) => ({
          ...a,
          password: a.userId
            ? null
            : (sharedPassword ?? randomBytes(24).toString("base64url")),
        })),
      };
      writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        `Private account credentials / recovery journal: ${journalPath}`,
      );
      for (const account of journal.accounts) {
        if (account.userId) continue;
        const created = await provider.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true,
        });
        if (created.error || !created.data.user?.id)
          throw new Error(
            "Staff identity creation failed or was interrupted. Review the saved journal and Auth users before retrying.",
          );
        account.userId = created.data.user.id;
        saveJournal();
      }
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='10s'");
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        actor.id,
      ]);
      await db.query(
        "SELECT id FROM portal.staff_profiles WHERE role='ADMIN' ORDER BY id FOR UPDATE",
      );
      if (options.reset) {
        const deleted = await resetBusinessData(
          db,
          journal.accounts.map((a) => a.userId),
        );
        if (JSON.stringify(deleted) !== JSON.stringify(removed))
          throw new Error(
            "Staff changed during preflight; reset rolled back. Review and rerun.",
          );
      }
      for (const a of journal.accounts) {
        const inserted = await db.query(
          "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,$2,$3,true) ON CONFLICT(id) DO NOTHING RETURNING id",
          [a.userId, a.displayName, a.role],
        );
        if (inserted.rowCount) {
          await db.query(
            "INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES($1,'STAFF_PROFILE',$2,'STAFF_LINKED',$3::jsonb,$4)",
            [
              actor.id,
              a.userId,
              JSON.stringify({ role: a.role, active: true }),
              randomUUID(),
            ],
          );
        } else {
          const current = (
            await db.query(
              "SELECT role,active FROM portal.staff_profiles WHERE id=$1",
              [a.userId],
            )
          ).rows[0];
          if (current?.role !== a.role || !current.active)
            throw new Error("Seed account access changed during preflight.");
        }
      }
      const result = await seedVacancies(db, actor.id);
      const createdIds = result.jobs
        .filter((r) => r.action === "create-published")
        .map((r) => r.id);
      const live = Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM portal.jobs WHERE id=ANY($1::uuid[]) AND status='PUBLISHED' AND published_content IS NOT NULL AND published_version=version AND approved_at IS NOT NULL AND publish_at<=statement_timestamp() AND close_at>statement_timestamp()",
            [createdIds],
          )
        ).rows[0].n,
      );
      if (live !== createdIds.length)
        throw new Error(
          "Seed verification failed: a new vacancy is not publicly visible.",
        );
      const afterAdmins = (
        await db.query(
          "SELECT id,role,active,version FROM portal.staff_profiles WHERE role='ADMIN' ORDER BY created_at,id",
        )
      ).rows;
      if (JSON.stringify(afterAdmins) !== JSON.stringify(admins))
        throw new Error("Admin preservation check failed.");
      await db.query("COMMIT");
      journal.committed = true;
      saveJournal();
      await cleanupProviderUsers(provider);
      console.log(
        `Committed: ${createdIds.length} published jobs created, ${result.jobs.length - createdIds.length} existing jobs preserved; company sections seeded/preserved.`,
      );
      console.log(
        "Admin credentials unchanged. No invitation emails sent. No fabricated applications or traffic metrics added.",
      );
    }
  }
} catch (error) {
  if (db) await db.query("ROLLBACK").catch(() => {});
  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? ` (${error.code})`
      : "";
  console.error(
    error?.constructor === Error && !error.code
      ? error.message
      : `Seed failed${code}; verify credentials, deployed migrations and target permissions.`,
  );
  if (journalPath)
    console.error(
      `Review recovery journal: ${journalPath}. Confirm committed state before retrying a reset.`,
    );
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
