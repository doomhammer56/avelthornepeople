import { readFileSync } from "node:fs";
import "dotenv/config";
import { defineConfig } from "prisma/config";
import managedAuth from "./prisma/external-auth.json";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    initShadowDb: readFileSync(
      new URL("./prisma/shadow-auth.sql", import.meta.url),
      "utf8",
    ),
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: managedAuth.tables,
  },
  enums: {
    external: managedAuth.enums,
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
