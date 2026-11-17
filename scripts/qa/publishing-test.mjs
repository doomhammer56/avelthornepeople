import { spawn } from "node:child_process";
import { loadAuthTestEnvironment } from "../auth/test-env.mjs";

const options = process.argv.slice(2);
if (options.some((value) => value !== "--park-managed-test-content"))
  throw new Error(
    "Supported option: --park-managed-test-content (temporarily isolates and restores managed QA content)",
  );
loadAuthTestEnvironment();
// Never inherit an accidental opt-in from the caller's environment.
process.env.CONTENT_E2E_PARK_MANAGED = options.includes(
  "--park-managed-test-content",
)
  ? "1"
  : "0";
if (process.env.CONTENT_E2E_PARK_MANAGED === "1")
  console.log(
    "QA-01: temporarily parking managed test slots; originals are backed up and verified on restore. Keep the test project idle during this run.",
  );
const child = spawn(
  process.execPath,
  [
    "--conditions=react-server",
    "--test",
    "--test-concurrency=1",
    "tests/e2e/jobs/management.test.mjs",
    "tests/e2e/content/management.test.mjs",
  ],
  { env: process.env, stdio: "inherit", windowsHide: true },
);
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
