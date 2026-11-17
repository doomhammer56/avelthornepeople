import assert from "node:assert/strict";

export async function expectQueryError(db, sql, parameters, code) {
  await db.query("SAVEPOINT expected_error");
  try {
    await assert.rejects(db.query(sql, parameters), { code });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT expected_error");
    await db.query("RELEASE SAVEPOINT expected_error");
  }
}

export async function createStaffFixture(db) {
  const staffId = process.env.TEST_STAFF_USER_ID;
  assert.match(
    staffId ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Set TEST_STAFF_USER_ID to a dedicated Supabase test user's UUID.",
  );
  const identity = await db.query(
    "SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1) AS present",
    [staffId],
  );
  assert.equal(
    identity.rows[0].present,
    true,
    "The test Auth user must exist.",
  );
  await db.query(
    "INSERT INTO portal.staff_profiles (id, display_name) VALUES ($1, 'DB-01 fixture') ON CONFLICT (id) DO NOTHING",
    [staffId],
  );
  return staffId.toLowerCase();
}
