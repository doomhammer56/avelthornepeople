import "server-only";
import { X509Certificate } from "node:crypto";
import type pg from "pg";

// Apply after URI normalization: pg connection-string SSL flags otherwise
// override an explicit ssl object, including certificate/hostname verification.
export function verifiedDatabaseConfig(
  config: pg.PoolConfig,
  env: NodeJS.ProcessEnv = process.env,
): pg.PoolConfig {
  const fail = () => new Error("Invalid database TLS configuration");
  let connectionString = config.connectionString;
  let host = config.host ?? env.PGHOST ?? "localhost";
  if (connectionString) {
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw fail();
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw fail();
    host = url.searchParams.get("host") ?? url.hostname;
    for (const key of [
      "ssl",
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "uselibpqcompat",
    ])
      url.searchParams.delete(key);
    connectionString = url.toString();
  }
  if (env.DATABASE_ALLOW_LOCAL_PLAINTEXT === "true") {
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
      throw fail();
    return { ...config, connectionString, ssl: false };
  }
  const ca = env.DATABASE_TLS_CA?.replace(/\\n/g, "\n").trim();
  if (ca) {
    const certificates = ca.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    );
    if (
      !certificates?.length ||
      ca
        .replace(
          /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
          "",
        )
        .trim()
    )
      throw fail();
    try {
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
      throw fail();
    }
  }
  return {
    ...config,
    connectionString,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}
