import { execFileSync } from "node:child_process";
import { loadAuthTestEnvironment } from "../auth/test-env.mjs";

try {
  loadAuthTestEnvironment();
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { stdio: "inherit", env: process.env, windowsHide: true },
  );
} catch {
  console.error(
    "Dashboard test migration deployment failed; check the guarded test environment and migration output.",
  );
  process.exitCode = 1;
}
