import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  departments,
  locations,
  vacancies,
} from "../../../scripts/seed/data.mjs";
import {
  vacancyDraft,
  businessTables,
} from "../../../scripts/seed/database.mjs";
import {
  seedOptions,
  seedEnvironment,
} from "../../../scripts/seed/options.mjs";
import { createJobSchema } from "../../../src/server/jobs/management-contract.ts";

test("Ten distinct bilingual vacancies satisfy the editor contract and use real office taxonomies", () => {
  assert.equal(vacancies.length, 10);
  assert.equal(new Set(vacancies.map((v) => v.slug)).size, 10);
  const now = new Date("2026-10-26T12:00:00Z");
  for (const vacancy of vacancies) {
    assert.ok(departments.some((d) => d.code === vacancy.department));
    assert.ok(locations.some((l) => l.code === vacancy.location));
    const draft = vacancyDraft(vacancy, randomUUID(), randomUUID(), now);
    assert.ok(
      createJobSchema.safeParse({
        id: randomUUID(),
        slug: vacancy.slug,
        draft,
        requestId: randomUUID(),
      }).success,
    );
    assert.ok(Date.parse(draft.settings.publishAt) < now.getTime());
    assert.ok(
      Date.parse(draft.settings.closeAt) > now.getTime() + 29 * 86400000,
    );
    for (const lang of ["en", "zh"]) {
      assert.ok(
        draft[lang].responsibilities.length >= 3 &&
          draft[lang].requirements.length >= 3,
      );
      assert.doesNotMatch(
        JSON.stringify(draft[lang]),
        /\b(demo|fixture|placeholder|lorem ipsum)\b/i,
      );
    }
    assert.ok(!("developmentFixture" in draft));
  }
});

test("Normal npm seeding applies directly; preview is separate and destructive actions require an explicit project", (t) => {
  const scripts = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ).scripts;
  assert.match(scripts["db:seed"], /\s--apply(?:\s|$)/);
  assert.doesNotMatch(scripts["db:seed:preview"], /\s--apply(?:\s|$)/);
  const options = seedOptions([]);
  assert.equal(options.apply, false);
  assert.equal(options.reset, false);
  assert.equal(options["with-staff"], false);
  assert.equal(options["env-file"], ".env");
  assert.equal(seedOptions(["--apply"]).apply, true);
  assert.equal(seedOptions(["--apply"]).reset, false);
  assert.throws(() => seedOptions(["--apply", "--reset"]), /project/);
  assert.throws(
    () => seedOptions(["--apply", "--cleanup-file", "journal.json"]),
    /project/,
  );
  assert.throws(
    () => seedOptions(["--apply", "--project", "invalid"]),
    /project/,
  );
  assert.equal(
    seedOptions(["--apply", "--reset", "--project", "aaaaaaaaaaaaaaaaaaaa"])
      .reset,
    true,
  );
  assert.throws(
    () => seedOptions(["--staff-password-file", ".env.seed-password"]),
    /with-staff/,
  );
  assert.throws(
    () => seedOptions(["--cleanup-file", "journal.json", "--reset"]),
    /combined/,
  );
  assert.throws(() => seedOptions(["--staff-domain", "invalid domain"]));
  assert.throws(() => seedOptions(["--unrecognized"]));
  assert.ok(!businessTables.includes("staff_profiles"));
  assert.ok(
    businessTables.includes("applications") &&
      businessTables.includes("jobs") &&
      businessTables.includes("audit_logs"),
  );
  const file = join(tmpdir(), `seed-env-${randomUUID()}`);
  t.after(() => unlinkSync(file));
  writeFileSync(
    file,
    "SUPABASE_URL=https://bbbbbbbbbbbbbbbbbbbb.supabase.co\nDIRECT_URL=postgresql://postgres.bbbbbbbbbbbbbbbbbbbb:placeholder@host.pooler.supabase.com/db\n",
    { flag: "wx" },
  );
  assert.throws(
    () => seedEnvironment(file, "aaaaaaaaaaaaaaaaaaaa"),
    /must match/,
  );
});
