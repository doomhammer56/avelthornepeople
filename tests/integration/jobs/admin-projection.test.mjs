import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { adminJobProjection } from "../../../src/server/jobs/management-read.ts";
import { adminJobSummaryDto } from "../../../src/server/admin/dto.ts";

test("summary SQL avoids long documents for drafts/unchanged publications and preserves exact change semantics", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA portal;
      CREATE TABLE portal.jobs(id uuid,created_at timestamptz,canonical_slug text,status text,department_id uuid,job_type text,experience text,
        salary_min numeric,salary_max numeric,salary_currency text,salary_period text,show_salary boolean,publish_at timestamptz,close_at timestamptz,
        draft_content jsonb,published_content jsonb,approved_at timestamptz,published_version integer);
      CREATE TABLE portal.job_locations(job_id uuid,location_id uuid);
      CREATE TABLE portal.applications(job_id uuid,intake_state text);`);
    const settings = {
      departmentId: null,
      locationIds: [],
      jobType: "FULL_TIME",
      experience: "ANY",
      salary: null,
      showSalary: false,
      publishAt: "2026-10-28T00:00:00Z",
      closeAt: null,
    };
    const draft = {
      en: {
        title: "Engineer",
        responsibilities: ["Long private text ".repeat(2000)],
        requirements: [],
      },
      zh: { title: "Engineer ZH", responsibilities: [], requirements: [] },
      settings,
    };
    for (const variant of [
      "draft",
      "same",
      "changed",
      "reverted",
      "offset",
      "legacy",
      "ignored",
    ]) {
      const next = structuredClone(draft),
        published = { ...structuredClone(draft), englishFallback: false };
      if (variant === "changed") next.en.title = "Changed";
      if (variant === "offset")
        next.settings.publishAt = "2026-10-28T02:00:00+02:00";
      if (variant === "ignored") next.unused = "ignored";
      if (variant === "legacy") {
        delete next.settings;
        delete published.settings;
      }
      await db.query(
        `INSERT INTO portal.jobs(id,created_at,canonical_slug,status,job_type,experience,publish_at,draft_content,published_content) VALUES('11111111-1111-1111-1111-111111111111',now(),'test','PUBLISHED','FULL_TIME','ANY','2026-10-28T00:00:00Z',$1,$2)`,
        [
          JSON.stringify(next),
          variant === "draft" ? null : JSON.stringify(published),
        ],
      );
      const full = (
        await db.query(
          `SELECT ${adminJobProjection("READ_ONLY")} FROM portal.jobs j`,
        )
      ).rows[0];
      const reduced = (
        await db.query(
          `SELECT ${adminJobProjection("READ_ONLY", true)} FROM portal.jobs j`,
        )
      ).rows[0];
      assert.deepEqual(
        adminJobSummaryDto(reduced),
        adminJobSummaryDto(full),
        variant,
      );
      if (["draft", "same", "reverted"].includes(variant)) {
        assert.ok(
          !JSON.stringify(reduced).includes("Long private text"),
          variant,
        );
        assert.ok(
          JSON.stringify(reduced).length < JSON.stringify(full).length / 10,
        );
      }
      await db.exec("DELETE FROM portal.jobs");
    }
  } finally {
    await db.close();
  }
});
