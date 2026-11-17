import "dotenv/config";
import { loadAuthTestEnvironment } from "./test-env.mjs";
import {
  authConfig,
  appOrigin,
  authFetch,
  requireCaptchaConfiguration,
} from "../../src/server/adapters/auth/config.ts";
import { withRuntime } from "../../src/server/database/runtime.ts";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--test"))
    throw new Error();
  if (args[0] === "--test") loadAuthTestEnvironment();
  const { url, key } = authConfig();
  const response = await authFetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
  });
  if (!response.ok) throw new Error();
  const settings = await response.json();
  let originConfigured = false,
    captchaSiteKeyConfigured = false;
  try {
    appOrigin();
    originConfigured = true;
  } catch {}
  try {
    requireCaptchaConfiguration();
    captchaSiteKeyConfigured = true;
  } catch {}
  const helpersInstalled = await withRuntime(
    null,
    async (db) =>
      (
        await db.query(
          "SELECT to_regprocedure('portal_private.staff_session_is_admitted(uuid)') IS NOT NULL AND to_regprocedure('portal_private.begin_staff_login(uuid)') IS NOT NULL AND to_regprocedure('portal_private.finish_staff_login(uuid,uuid,text,uuid)') IS NOT NULL AND to_regprocedure('portal_private.consume_login_traffic(uuid,text)') IS NOT NULL AND to_regprocedure('portal_private.password_grant_is_valid(uuid,bytea)') IS NOT NULL AND to_regprocedure('portal_private.begin_password_change(uuid,bytea)') IS NOT NULL AND to_regprocedure('portal_private.finish_password_change(uuid,bytea,uuid,text)') IS NOT NULL AS present",
        )
      ).rows[0].present,
  );
  const checks = {
    emailPasswordEnabled: !!settings.external?.email,
    publicSignupDisabled: settings.disable_signup === true,
    originConfigured,
    captchaSiteKeyConfigured,
    limiterSecretConfigured:
      (process.env.AUTH_LIMITER_SECRET?.length ?? 0) >= 32,
    restrictedRuntimeAndAuthHelpers: !!helpersInstalled,
  };
  console.log(JSON.stringify(checks, null, 2));
  console.log(
    "Also verify provider CAPTCHA, trusted ingress, SMTP delivery and email templates in the dashboard; public Auth settings do not prove those controls.",
  );
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
} catch {
  console.error(
    "Auth readiness check failed. Check configuration and the restricted runtime connection; no credential values displayed.",
  );
  process.exitCode = 1;
} finally {
  // CLI pools have idle timeouts; exiting avoids leaving a verification shell
  // open while those idle connections expire.
  const { runtimePool } = await import("../../src/server/database/runtime.ts");
  if (process.env.DATABASE_URL)
    await runtimePool()
      .end()
      .catch(() => {});
}
