import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { authAdminClient } from "../../src/server/adapters/auth/admin.ts";
import { identityClient } from "../../src/server/adapters/auth/config.ts";
export async function createStaffSession(db, role = "ADMIN") {
  const provider = authAdminClient(),
    email = `fixture-${randomUUID()}@example.invalid`;
  const created = await provider.auth.admin.createUser({
    email,
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const id = created.data.user.id;
  try {
    const link = await provider.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    assert.equal(link.error, null);
    const verified = await identityClient().auth.verifyOtp({
      type: "magiclink",
      token_hash: link.data.properties.hashed_token,
    });
    assert.equal(verified.error, null);
    const token = verified.data.session.access_token,
      sessionId = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ).session_id;
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'Synthetic staff',$2,true)",
      [id, role],
    );
    await db.query(
      "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [sessionId, id],
    );
    return {
      id,
      role,
      token,
      sessionId,
      cookie: `sb-${process.env.AUTH_TEST_PROJECT_REF}-auth-token=base64-${Buffer.from(JSON.stringify(verified.data.session)).toString("base64url")}`,
      async remove() {
        assert.equal((await provider.auth.admin.deleteUser(id)).error, null);
      },
    };
  } catch (error) {
    await provider.auth.admin.deleteUser(id);
    throw error;
  }
}
