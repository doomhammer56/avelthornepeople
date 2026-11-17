import { execFileSync } from "node:child_process";
import { loadAuthTestEnvironment } from "./test-env.mjs";

try {
  loadAuthTestEnvironment();
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { stdio: "inherit", env: process.env, windowsHide: true },
  );
} catch {
  console.error(
    "Auth test migration deployment failed; check the test environment and migration output.",
  );
  process.exitCode = 1;
}
