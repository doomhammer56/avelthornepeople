import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCvStorage } from "../../../src/server/adapters/storage/cv-storage.ts";

function intent() {
  const id = randomUUID();
  return {
    id,
    objectKey: `${id}/${randomUUID()}.pdf`,
    providerExpiresAt: new Date(Date.now() - 600000),
  };
}
function fixture(error = null) {
  const calls = [];
  const storage = createCvStorage({
    storage: {
      from(bucket) {
        assert.equal(bucket, "cv-quarantine");
        return {
          remove: async (keys) => {
            calls.push(keys);
            return { data: error ? null : [], error };
          },
        };
      },
    },
  });
  return { storage, calls };
}

test("quarantine cleanup deletes a complete batch in one provider call", async () => {
  const f = fixture();
  const intents = Array.from({ length: 20 }, intent);
  await f.storage.removeExpiredQuarantines(intents);
  assert.deepEqual(f.calls, [intents.map((row) => row.objectKey)]);
});

test("every object must pass key and grace-period checks before a batch is sent", async () => {
  const f = fixture();
  for (const bad of [
    { ...intent(), providerExpiresAt: new Date(Date.now() - 1000) },
    { ...intent(), objectKey: "../../another-bucket/file.pdf" },
    { ...intent(), providerExpiresAt: new Date("invalid") },
  ])
    await assert.rejects(f.storage.removeExpiredQuarantines([intent(), bad]));
  await assert.rejects(
    f.storage.removeExpiredQuarantines(Array.from({ length: 21 }, intent)),
  );
  await f.storage.removeExpiredQuarantines([]);
  assert.equal(f.calls.length, 0);
});

test("bulk provider errors are surfaced so database rows remain retryable", async () => {
  const f = fixture(new Error("Provider unavailable"));
  await assert.rejects(f.storage.removeExpiredQuarantines([intent()]), {
    code: "PROVIDER",
  });
});
