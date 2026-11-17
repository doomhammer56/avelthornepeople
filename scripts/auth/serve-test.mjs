import { spawn } from "node:child_process";
import { loadAuthTestEnvironment } from "./test-env.mjs";

try {
  loadAuthTestEnvironment();
  const origin = new URL(process.env.AUTH_APP_ORIGIN);
  if (
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.protocol !== "http:"
  )
    throw new Error(
      "Test development server requires a loopback AUTH_APP_ORIGIN.",
    );
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      origin.hostname,
      "--port",
      origin.port || "80",
    ],
    { stdio: "inherit", env: process.env, windowsHide: true },
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  child.on("error", () => {
    console.error("Test development server could not start.");
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
