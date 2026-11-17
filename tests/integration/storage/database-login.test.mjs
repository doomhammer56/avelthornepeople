import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCvRepository } from "../../../src/server/storage/repository.ts";

test(
  "CV repository requires a restricted login and clears pooled role/claims",
  { timeout: 60_000 },
  async () => {
    assert.ok(
      process.env.DIRECT_URL,
      "DIRECT_URL for the dedicated test project is required.",
    );
    const ownerPool = new pg.Pool({
      connectionString: process.env.DIRECT_URL,
      max: 1,
      connectionTimeoutMillis: 10000,
    });
    const name = `storage01_${randomBytes(8).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    let runtimePool;
    let created = false;
    try {
      await assert.rejects(
        createCvRepository(ownerPool).withSubject(
          randomUUID(),
          async () => "forbidden",
        ),
        { status: 503 },
      );
      await ownerPool.query(
        `CREATE ROLE ${pg.escapeIdentifier(name)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`,
      );
      created = true;
      await ownerPool.query(
        `GRANT portal_runtime TO ${pg.escapeIdentifier(name)}`,
      );
      const url = new URL(process.env.DIRECT_URL);
      const suffix = decodeURIComponent(url.username)
        .split(".")
        .slice(1)
        .join(".");
      url.username = suffix ? `${name}.${suffix}` : name;
      url.password = password;
      runtimePool = new pg.Pool({
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 15000,
      });
      const repository = createCvRepository(runtimePool);
      const role = await repository.withSubject(
        randomUUID(),
        async (session) => {
          assert.equal(await session.findCv(randomUUID()), null);
          return session.role();
        },
      );
      assert.equal(
        role,
        null,
        "A verified UUID alone cannot supply a business role.",
      );
      const restored = (
        await runtimePool.query(
          "SELECT current_user=session_user AS reset, nullif(current_setting('request.jwt.claim.sub',true),'') AS subject",
        )
      ).rows[0];
      assert.deepEqual(restored, { reset: true, subject: null });
    } finally {
      await runtimePool?.end();
      try {
        if (created)
          await ownerPool.query(`DROP ROLE ${pg.escapeIdentifier(name)}`);
      } finally {
        await ownerPool.end();
      }
    }
  },
);
