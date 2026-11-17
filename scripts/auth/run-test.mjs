import { spawn } from "node:child_process";
import { loadAuthTestEnvironment } from "./test-env.mjs";

try {
  loadAuthTestEnvironment();
  const suites = {
    database: ["tests/integration/database/*.test.mjs"],
    storage: [
      "tests/integration/storage/*.test.mjs",
      "tests/e2e/storage/cv-url.test.mjs",
    ],
    cv: ["tests/e2e/storage/cv-url.test.mjs"],
  };
  const files = suites[process.argv[2]];
  if (!files) throw new Error("Choose database, storage or cv regression.");
  const child = spawn(
    process.execPath,
    ["--conditions=react-server", "--test", "--test-concurrency=1", ...files],
    { stdio: "inherit", env: process.env, windowsHide: true },
  );
  child.on("error", () => {
    console.error("Test runner could not start.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
