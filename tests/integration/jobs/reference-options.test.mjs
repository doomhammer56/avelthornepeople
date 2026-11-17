import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { adminReferenceSql } from "../../../src/server/admin/queries.ts";
import { applicationJobOptionSql } from "../../../src/server/applications/service.ts";

test("one reference query retains ordered bilingual labels, versions, inactive values and location details", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA portal;
      CREATE TABLE portal.departments(id uuid,code text,name_en text,name_zh text,active boolean,version integer);
      CREATE TABLE portal.locations(LIKE portal.departments,country_code text,timezone text,address_en text,address_zh text);
      CREATE TABLE portal.job_options(LIKE portal.departments,kind text);
      INSERT INTO portal.departments VALUES(null,'Z','Zed','Zed ZH',false,2),(null,'A','Alpha','Alpha ZH',true,3);
      INSERT INTO portal.locations VALUES(null,'RW','Office','Office ZH',true,4,'RW','Africa/Kigali','Street','Street ZH');
      INSERT INTO portal.job_options VALUES(null,'FULL_TIME','Full time','Full ZH',true,5,'jobType'),(null,'ANY','Any','Any ZH',false,6,'experience');`);
    const data = (await db.query(adminReferenceSql)).rows[0];
    assert.deepEqual(
      data.departments.map((row) => row.code),
      ["A", "Z"],
    );
    assert.equal(data.departments[1].active, false);
    assert.equal(data.locations[0].timezone, "Africa/Kigali");
    assert.equal(data.locations[0].address_zh, "Street ZH");
    assert.deepEqual(
      data.options.map((row) => row.version),
      [6, 5],
    );
    await db.exec(
      "TRUNCATE portal.departments,portal.locations,portal.job_options",
    );
    assert.deepEqual((await db.query(adminReferenceSql)).rows[0], {
      departments: [],
      locations: [],
      options: [],
    });
  } finally {
    await db.close();
  }
});

test("job filter options are bounded, searchable, page correctly and retain an off-page selection without duplicates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA portal; CREATE TABLE portal.jobs(id uuid PRIMARY KEY,draft_content jsonb);
      CREATE TABLE portal.applications(job_id uuid,intake_state text);
      INSERT INTO portal.jobs SELECT (lpad(n::text,8,'0')||'-1111-1111-1111-111111111111')::uuid,jsonb_build_object('en',jsonb_build_object('title','Role '||n),'zh',jsonb_build_object('title','Role ZH '||n)) FROM generate_series(1,205) n;
      INSERT INTO portal.applications SELECT id,'CONFIRMED' FROM portal.jobs;
      INSERT INTO portal.applications SELECT id,'CONFIRMED' FROM portal.jobs;`);
    const first = (await db.query(applicationJobOptionSql, ["", 0, null])).rows;
    const second = (await db.query(applicationJobOptionSql, ["", 100, null]))
      .rows;
    const last = (await db.query(applicationJobOptionSql, ["", 200, null]))
      .rows;
    assert.equal(first.length, 100);
    assert.equal(second.length, 100);
    assert.equal(last.length, 5);
    assert.equal(
      new Set([...first, ...second, ...last].map((row) => row.id)).size,
      205,
    );
    const selected = last[0].id;
    assert.equal(
      (await db.query(applicationJobOptionSql, ["", 0, selected])).rows.length,
      101,
    );
    assert.equal(
      (await db.query(applicationJobOptionSql, ["", 200, selected])).rows
        .length,
      5,
    );
    const search = (
      await db.query(applicationJobOptionSql, ["Role ZH 205", 0, null])
    ).rows;
    assert.equal(search.length, 1);
    assert.equal(search[0].en, "Role 205");
    await db.exec("UPDATE portal.applications SET intake_state='QUARANTINED'");
    assert.equal(
      (await db.query(applicationJobOptionSql, ["", 0, selected])).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
