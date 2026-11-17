import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useApplicationForm } from "./useApplicationForm.ts";
import { applicationContent } from "./applicationContent.ts";

// Exercise the actual form hook and resolver without a database or a new DOM dependency.
function formFixture(lang = "en") {
  let form;
  function Harness() {
    form = useApplicationForm(applicationContent[lang].validation);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  const unsubscribe = form.subscribe({
    formState: { values: true },
    callback() {},
  });
  const file = new File(["%PDF-1.7\n%%EOF"], "cv.pdf", {
    type: "application/pdf",
  });
  const input = {
    name: "resume",
    type: "file",
    value: "",
    files: { 0: file, length: 1, item: () => file },
    focus() {},
  };
  form.resumeField.ref(input);
  for (const [key, value] of Object.entries({
    name: "Applicant",
    email: "applicant@example.invalid",
    phone: "+60123456789",
    consent: true,
  }))
    form.setValue(key, value);
  return { form, file, input, unsubscribe };
}

test("A selected PDF remains a File after the file input blurs and is submitted", async (t) => {
  const { form, file, input, unsubscribe } = formFixture();
  t.after(unsubscribe);
  form.setValue("resume", file, { shouldValidate: true, shouldDirty: true });
  await form.resumeField.onBlur({ target: input, type: "blur" });
  let submitted;
  let errors;
  await form.handleSubmit(
    (values) => {
      submitted = values;
    },
    (invalid) => {
      errors = invalid;
    },
  )();
  assert.equal(errors, undefined);
  assert.equal(submitted.resume, file);
});

test("phone country selection permits local entry and puts invalid numbers on the phone field in EN/ZH", async (t) => {
  for (const lang of ["en", "zh"]) {
    const { form, file, unsubscribe } = formFixture(lang);
    t.after(unsubscribe);
    form.setValue("resume", file);
    form.setValue("phone", "+0164536156465");
    assert.equal(await form.trigger("phone"), false);
    assert.equal(
      form.getFieldState("phone").error.message,
      applicationContent[lang].validation.phone,
    );
    form.setValue("phoneCountry", "MY");
    form.setValue("phone", "0123456789");
    assert.equal(await form.trigger("phone"), true);
    let submitted;
    await form.handleSubmit((values) => {
      submitted = values;
    })();
    assert.equal(submitted.phoneCountry, "MY");
    assert.equal(submitted.phone, "0123456789");
  }
});

test("Dropped/replaced CVs survive ref updates; removal still requires a file in EN/ZH", async (t) => {
  for (const lang of ["en", "zh"]) {
    const { form, file, input, unsubscribe } = formFixture(lang);
    t.after(unsubscribe);
    // Drag/drop sets the form value while the native picker still has no files.
    input.files = { length: 0, item: () => null };
    form.setValue("resume", file, { shouldValidate: true });
    form.resumeField.ref(null);
    form.resumeField.ref(input);
    await form.resumeField.onBlur({ target: input, type: "blur" });
    assert.equal(await form.trigger("resume"), true);
    const replacement = new File(["doc"], "replacement.doc", {
      type: "application/msword",
    });
    form.setValue("resume", replacement, { shouldValidate: true });
    await form.resumeField.onBlur({ target: input, type: "blur" });
    let submitted;
    await form.handleSubmit((values) => {
      submitted = values;
    })();
    assert.equal(submitted.resume, replacement);
    form.setValue("resume", null, { shouldValidate: true });
    await form.trigger("resume");
    assert.equal(
      form.getFieldState("resume").error.message,
      applicationContent[lang].validation.resumeRequired,
    );
    form.setValue("resume", file, { shouldValidate: true });
    await form.trigger("resume");
    assert.equal(form.getFieldState("resume").error, undefined);
    form.reset();
    assert.equal(form.getValues("resume"), null);
  }
});
