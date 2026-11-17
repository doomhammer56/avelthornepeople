import assert from "node:assert/strict";
import test from "node:test";
import { contactContent } from "./contactContent.ts";
import { createContactSchema, sendContactMessage } from "./contactForm.ts";

const values = {
  name: "Example Visitor",
  company: "",
  email: "visitor@example.test",
  message: "Example enquiry",
};

// Exercise required fields and limits without involving real contact records.
// Frontend validation must reject empty content before any delivery attempt.
test("contact validation trims values, accepts optional company and enforces bounds", () => {
  const schema = createContactSchema(contactContent.en.validation);
  assert.equal(
    schema.parse({ ...values, name: "  Example Visitor  " }).name,
    "Example Visitor",
  );
  for (const change of [
    { name: " " },
    { email: "invalid" },
    { message: " " },
    { name: "x".repeat(121) },
    { company: "x".repeat(161) },
    { message: "x".repeat(5001) },
  ]) {
    assert.equal(schema.safeParse({ ...values, ...change }).success, false);
  }
  const translated = createContactSchema(
    contactContent.zh.validation,
  ).safeParse({ ...values, name: "" });
  assert.equal(translated.success, false);
  assert.equal(
    translated.error.issues[0].message,
    contactContent.zh.validation.required,
  );
});

// Verify the public payload and transport without making a network request.
// Contact fields belong only in a POST body, and success requires explicit acceptance.
test("contact delivery uses a minimal POST and requires an accepted acknowledgement", async (t) => {
  const calls = [];
  let result = () =>
    new Response(JSON.stringify({ accepted: true }), { status: 201 });
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return result();
  });
  await sendContactMessage(
    "/test-contact",
    values,
    "zh",
    new AbortController().signal,
  );
  assert.equal(calls[0][0], "/test-contact");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].credentials, "omit");
  assert.deepEqual(JSON.parse(calls[0][1].body), { ...values, locale: "zh" });
  for (const response of [
    new Response("{}", { status: 503 }),
    new Response("{}", { status: 200 }),
    new Response("invalid", { status: 200 }),
  ]) {
    result = () => response;
    await assert.rejects(
      sendContactMessage(
        "/test-contact",
        values,
        "en",
        new AbortController().signal,
      ),
    );
  }
  result = () => {
    throw new Error("Network unavailable");
  };
  await assert.rejects(
    sendContactMessage(
      "/test-contact",
      values,
      "en",
      new AbortController().signal,
    ),
  );
});
