import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  receiveApplication,
  intakeErrorResponse,
} from "../../../src/server/applications/intake.ts";

let saved;
beforeEach(() => {
  const env = {
    PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    AUTH_TRUSTED_IP_HEADER: "",
    AUTH_LIMITER_SECRET: randomBytes(32).toString("hex"),
    CANDIDATE_ACTIVE_KEY_VERSION: "1",
    CANDIDATE_ENCRYPTION_KEYS: JSON.stringify({
      1: randomBytes(32).toString("base64"),
    }),
    CANDIDATE_MATCH_KEYS: JSON.stringify({
      1: randomBytes(32).toString("base64"),
    }),
  };
  saved = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fixture() {
  const requestId = randomUUID(),
    uploadId = randomUUID(),
    jobId = randomUUID();
  const pdf = Buffer.from("%PDF-1.7\nsynthetic fixture\n%%EOF");
  const upload = {
    jobId,
    requestId,
    objectKey: `${uploadId}/${randomUUID()}.pdf`,
    size: pdf.length,
    acceptedSha256: null,
  };
  const body = {
    jobId,
    locale: "en",
    name: "Applicant",
    email: "applicant@example.invalid",
    phone: "+250788123456",
    coverLetter: "Synthetic cover letter",
    consent: true,
    consentVersion: "recruitment-24-months-v1",
    resumeToken: `${uploadId}.${randomBytes(32).toString("base64url")}`,
    captchaToken: "test-turnstile-token",
  };
  const calls = [];
  let committedDigest,
    storageUnavailable = false;
  const dependencies = {
    runTransaction: async (subject, action) => {
      assert.equal(subject, null);
      return action({
        query: async (sql, params) => {
          calls.push(sql);
          if (sql.includes("consume_intake_traffic"))
            return { rows: [{ retry: 0 }] };
          if (sql.includes("application_upload"))
            return { rows: [{ upload: { ...upload } }] };
          if (sql.includes("accept_application")) {
            committedDigest = params[11];
            upload.acceptedSha256 = params[6].toString("hex");
            return { rows: [{ status: "accepted" }] };
          }
          if (sql.includes("replay_application")) {
            if (!committedDigest.equals(params[4]))
              throw Object.assign(new Error("conflict"), { code: "40001" });
            return { rows: [{}] };
          }
          throw new Error("Unexpected SQL");
        },
      });
    },
    storage: () => {
      calls.push("storage");
      if (storageUnavailable) throw new Error("Storage unavailable");
      return {
        storage: {
          from: () => ({
            info: async () => ({
              data: { size: pdf.length, contentType: "application/pdf" },
            }),
            download: async () => ({ data: new Blob([pdf]) }),
          }),
        },
      };
    },
  };
  const request = (change = {}, origin = "http://127.0.0.1:3000") =>
    new Request(`${origin}/api/applications`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "idempotency-key": requestId,
      },
      body: JSON.stringify({ ...body, ...change }),
    });
  return {
    pdf,
    upload,
    request,
    dependencies,
    calls,
    outage: () => {
      storageUnavailable = true;
    },
  };
}

test("invalid phone, email, name and consent produce safe field errors before storage access", async () => {
  for (const [change, field] of [
    [{ phone: "+0164536156465" }, "phone"],
    [{ email: "invalid-email" }, "email"],
    [{ name: " " }, "name"],
    [{ consent: false }, "consent"],
    [{ coverLetter: "x".repeat(5001) }, "coverLetter"],
  ]) {
    const f = fixture();
    let failure;
    try {
      await receiveApplication(f.request(change), f.dependencies);
    } catch (error) {
      failure = error;
    }
    const response = intakeErrorResponse(failure);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "validation_failed");
    assert.equal(payload.issues[0].field, field);
    assert.deepEqual(Object.keys(payload.issues[0]).sort(), ["code", "field"]);
    assert.ok(!f.calls.includes("storage"));
    assert.ok(!f.calls.some((sql) => sql.includes("accept_application")));
  }
});

test("corrupt uploaded CVs return a resume error without provider details", async () => {
  const f = fixture();
  f.pdf.fill(0);
  let failure;
  try {
    await receiveApplication(f.request(), f.dependencies);
  } catch (error) {
    failure = error;
  }
  const response = intakeErrorResponse(failure);
  assert.equal(response.status, 400);
  assert.deepEqual((await response.json()).issues, [
    { field: "resume", code: "resume_invalid" },
  ]);
  assert.ok(!f.calls.some((sql) => sql.includes("accept_application")));
});

test("a saved submission is acknowledged during a storage outage without candidate keys", async () => {
  const f = fixture();
  assert.equal(
    (await receiveApplication(f.request(), f.dependencies)).status,
    "accepted",
  );
  f.outage();
  process.env.CANDIDATE_ENCRYPTION_KEYS = "{}";
  process.env.CANDIDATE_MATCH_KEYS = "{}";
  f.calls.length = 0;
  assert.deepEqual(await receiveApplication(f.request(), f.dependencies), {
    status: "duplicate",
    confirmationEmailSent: false,
  });
  assert.equal(f.calls.includes("storage"), false);
  assert.equal(
    f.calls.some((sql) => sql.includes("accept_application")),
    false,
  );
  assert.equal(
    f.calls.filter((sql) => sql.includes("replay_application")).length,
    1,
  );
});

test("a changed replay payload still returns a conflict", async () => {
  const f = fixture();
  await receiveApplication(f.request(), f.dependencies);
  f.outage();
  for (const change of [
    { name: "Changed" },
    { coverLetter: "Changed" },
    { locale: "zh" },
  ]) {
    await assert.rejects(
      receiveApplication(f.request(change), f.dependencies),
      (error) => {
        assert.equal(intakeErrorResponse(error).status, 409);
        return true;
      },
    );
  }
});

test("new submissions still require storage and complete file validation", async () => {
  const f = fixture();
  f.outage();
  await assert.rejects(receiveApplication(f.request(), f.dependencies));
  assert.equal(
    f.calls.some((sql) => sql.includes("accept_application")),
    false,
  );
  const mismatch = fixture();
  mismatch.upload.size++;
  await assert.rejects(
    receiveApplication(mismatch.request(), mismatch.dependencies),
    { status: 400 },
  );
  assert.equal(
    mismatch.calls.some((sql) => sql.includes("accept_application")),
    false,
  );
});

test("replay retains origin/binding checks and rejects an invalid stored hash", async () => {
  const f = fixture();
  await receiveApplication(f.request(), f.dependencies);
  await assert.rejects(
    receiveApplication(f.request({}, "https://other.invalid"), f.dependencies),
    { status: 403 },
  );
  await assert.rejects(
    receiveApplication(f.request({ jobId: randomUUID() }), f.dependencies),
    { status: 400 },
  );
  f.upload.acceptedSha256 = "invalid";
  await assert.rejects(receiveApplication(f.request(), f.dependencies), {
    code: "UNAVAILABLE",
  });
});
