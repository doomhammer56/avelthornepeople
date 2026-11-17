import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { rootCertificates } from "node:tls";
import { verifiedDatabaseConfig } from "../../../src/server/database/tls.ts";
test("Every database connection verifies certificates despite URI flags or weak caller SSL options", () => {
  for (const flags of [
    "",
    "?sslmode=disable",
    "?ssl=no-verify",
    "?sslmode=require&uselibpqcompat=true",
    "?ssl=false&sslrootcert=do-not-read-this-file",
  ]) {
    const config = verifiedDatabaseConfig(
      {
        connectionString:
          "postgresql://user:password@db.example.invalid/db" + flags,
        ssl: { rejectUnauthorized: false },
        max: 2,
      },
      {},
    );
    const client = new pg.Client(config);
    assert.deepEqual(client.connectionParameters.ssl, {
      rejectUnauthorized: true,
    });
    assert.equal(client.connectionParameters.host, "db.example.invalid");
    assert.equal(client.connectionParameters.password, "password");
    assert.equal(config.max, 2);
  }
});
test("Trusted CA bundles survive driver parsing; malformed trust configuration fails without leaking inputs", () => {
  const cert = rootCertificates[0];
  const config = verifiedDatabaseConfig(
    {
      connectionString:
        "postgres://u:p@db.example.invalid/db?sslmode=verify-ca",
    },
    { DATABASE_TLS_CA: cert.replaceAll("\n", "\\n") },
  );
  assert.equal(new pg.Client(config).connectionParameters.ssl.ca, cert.trim());
  for (const value of [
    "password-in-invalid-CA",
    "-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----",
  ])
    assert.throws(
      () => verifiedDatabaseConfig({}, { DATABASE_TLS_CA: value }),
      { message: "Invalid database TLS configuration" },
    );
  assert.throws(
    () =>
      verifiedDatabaseConfig(
        { connectionString: "invalid://secret:password@host" },
        {},
      ),
    { message: "Invalid database TLS configuration" },
  );
});
test("Plaintext requires explicit local opt-in and cannot be redirected to a remote host by URI parameters", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(
      new pg.Client(
        verifiedDatabaseConfig(
          { connectionString: `postgresql://u:p@${host}/db` },
          { DATABASE_ALLOW_LOCAL_PLAINTEXT: "true" },
        ),
      ).connectionParameters.ssl,
      false,
    );
  for (const uri of [
    "postgresql://u:p@remote.invalid/db",
    "postgresql://u:p@localhost/db?host=remote.invalid",
    "postgresql://u:p@localhost/db?host=%2Ftmp",
  ])
    assert.throws(() =>
      verifiedDatabaseConfig(
        { connectionString: uri },
        { DATABASE_ALLOW_LOCAL_PLAINTEXT: "true" },
      ),
    );
  assert.equal(
    verifiedDatabaseConfig({ host: "localhost" }, {}).ssl.rejectUnauthorized,
    true,
  );
});
