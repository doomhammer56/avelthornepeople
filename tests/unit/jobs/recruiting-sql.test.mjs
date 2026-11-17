import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migration SQL: the previous normalizer first, then the fix-forward
// that adds the staff-only "recruiting" block, against an in-memory Postgres.
const migrations = "prisma/migrations/";
const read = (name) =>
  readFileSync(`${migrations}${name}/migration.sql`, "utf8");
const slice = (sql, from, to) => {
  const start = sql.indexOf(from);
  assert.notEqual(start, -1, from);
  return sql.slice(start, sql.indexOf(to, start) + to.length);
};

async function setup() {
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE portal_jobs_owner; CREATE SCHEMA portal_private; GRANT ALL ON SCHEMA portal_private TO portal_jobs_owner;",
  );
  const editor = read("20261025000300_job_editor_validation");
  await db.exec(
    slice(editor, "CREATE FUNCTION portal_private.job_invalid", "END $$;"),
  );
  await db.exec(
    slice(editor, "CREATE FUNCTION portal_private.job_trim", "$$;"),
  );
  await db.exec(
    slice(
      read("20261026000500_job_reference_management"),
      "CREATE OR REPLACE FUNCTION portal_private.normalize_job_draft",
      "END $$;",
    ),
  );
  return db;
}
const baseDraft = (extra = {}) => ({
  en: {
    title: " Assistant ",
    responsibilities: ["Help", " "],
    requirements: ["Diploma"],
  },
  zh: { title: "助理", responsibilities: ["协助"], requirements: ["学历"] },
  settings: {
    departmentId: null,
    locationIds: [],
    jobType: "FULL_TIME",
    experience: "ANY",
    salary: null,
    showSalary: false,
    publishAt: null,
    closeAt: null,
  },
  ...extra,
});
const normalize = async (db, draft) =>
  (
    await db.query(
      "SELECT portal_private.normalize_job_draft($1::jsonb) AS d",
      [JSON.stringify(draft)],
    )
  ).rows[0].d;
const issue = async (db, draft) => {
  try {
    await normalize(db, draft);
  } catch (error) {
    return JSON.parse(error.detail)[0];
  }
  return null;
};

test("The new normalizer is identical for drafts without recruiting details, and stores sparse details", async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const before = await normalize(db, baseDraft());
  const drafts = [
    baseDraft(),
    baseDraft({ recruiting: null }),
    baseDraft({ recruiting: {} }),
    baseDraft({
      recruiting: { priority: null, nationality: { en: "  ", zh: "" } },
    }),
  ];
  const olds = [];
  for (const draft of drafts.slice(0, 1)) olds.push(await normalize(db, draft));

  const migration = read("20261112000100_job_recruiting_details");
  await db.exec(
    migration
      .replace("GRANT portal_jobs_owner TO CURRENT_USER;", "")
      .replace("REVOKE portal_jobs_owner FROM CURRENT_USER;", ""),
  );
  assert.deepEqual(
    await normalize(db, drafts[0]),
    before,
    "unchanged for old drafts",
  );
  for (const draft of drafts.slice(1))
    assert.deepEqual(
      await normalize(db, draft),
      before,
      "empty details are dropped",
    );

  const stored = await normalize(
    db,
    baseDraft({
      recruiting: {
        priority: "URGENT",
        gender: "FEMALE_PREFERRED",
        nationality: { zh: " 非中國籍 ", en: "Non-Chinese" },
        age: { zh: "25-35歲" },
        remark: { en: "", zh: "" },
      },
    }),
  );
  assert.deepEqual(stored.recruiting, {
    priority: "URGENT",
    gender: "FEMALE_PREFERRED",
    nationality: { zh: "非中國籍", en: "Non-Chinese" },
    age: { zh: "25-35歲" },
  });
  assert.deepEqual(Object.keys(stored).sort(), [
    "en",
    "recruiting",
    "settings",
    "zh",
  ]);
  // Normalizing the stored form again changes nothing (needed for "no change" saves).
  assert.deepEqual(await normalize(db, stored), stored);
  assert.deepEqual(olds[0], before);
});

test("Recruiting details are validated with the safe issue vocabulary", async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await db.exec(
    read("20261112000100_job_recruiting_details")
      .replace("GRANT portal_jobs_owner TO CURRENT_USER;", "")
      .replace("REVOKE portal_jobs_owner FROM CURRENT_USER;", ""),
  );
  const cases = [
    [{ priority: "SOON" }, "draft.recruiting.priority", "invalid"],
    [{ priority: 3 }, "draft.recruiting.priority", "invalid"],
    [{ gender: "OTHER" }, "draft.recruiting.gender", "invalid"],
    [{ unknown: { zh: "x" } }, "draft.recruiting", "invalid"],
    [{ age: "25" }, "draft.recruiting", "invalid"],
    [{ age: { fr: "25" } }, "draft.recruiting", "invalid"],
    [{ age: { zh: 25 } }, "draft.recruiting", "invalid"],
    [{ other: { zh: "x".repeat(4001) } }, "draft.recruiting", "too_long"],
    ["text", "draft.recruiting", "invalid"],
  ];
  for (const [recruiting, field, code] of cases)
    assert.deepEqual(
      await issue(db, baseDraft({ recruiting })),
      { field, code },
      JSON.stringify(recruiting),
    );
  assert.equal(
    await issue(
      db,
      baseDraft({ recruiting: { other: { zh: "x".repeat(4000) } } }),
    ),
    null,
  );
  // Other unknown top-level keys are still refused.
  assert.deepEqual(await issue(db, { ...baseDraft(), extra: 1 }), {
    field: "draft",
    code: "invalid",
  });
});
