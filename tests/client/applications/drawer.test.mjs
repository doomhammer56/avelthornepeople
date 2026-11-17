import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { useApplicationForm } from "../../../src/lib/useApplicationForm.ts";
import * as transport from "../../../src/lib/applicationForm.ts";
import * as feedback from "../../../src/lib/applicationFeedback.ts";
import * as phone from "../../../src/lib/phoneNumber.ts";
import { applicationContent } from "../../../src/lib/applicationContent.ts";

function drawerFixture(locale, initialFailure = null) {
  const url = new URL(
    "../../../src/components/jobs/ApplicationDrawer.tsx",
    import.meta.url,
  );
  const require = createRequire(url),
    runtime = require("react/jsx-runtime");
  const elements = new Map();
  const validations = [];
  let hook = 0;
  let failure = initialFailure;
  let form;
  const wrap = (name) => (type, props, key) => {
    // Capture handlers for mocked components (Input, etc.), not only DOM tags.
    if (props && typeof props.id === "string") elements.set(props.id, props);
    return runtime[name](type, props, key);
  };
  const element = (tag, slot) =>
    function SheetFixture({ children, className }) {
      return React.createElement(
        tag,
        { className, "data-slot": slot },
        children,
      );
    };
  const mocks = {
    "next/script": {
      default: () => null,
    },
    "@/components/ui/dialog": {
      Dialog({ open, children }) {
        return open
          ? React.createElement("div", { "data-slot": "dialog" }, children)
          : null;
      },
      DialogContent({ children }) {
        return React.createElement("div", { "data-slot": "dialog-content" }, children);
      },
      DialogHeader({ children }) {
        return React.createElement("div", { "data-slot": "dialog-header" }, children);
      },
      DialogTitle({ children }) {
        return React.createElement("h3", { "data-slot": "dialog-title" }, children);
      },
      DialogDescription({ children }) {
        return React.createElement("p", { "data-slot": "dialog-description" }, children);
      },
      DialogFooter({ children }) {
        return React.createElement("div", { "data-slot": "dialog-footer" }, children);
      },
    },
    react: {
      ...React,
      useState(initial) {
        const isFailure = hook++ === 2;
        const [value, setValue] = React.useState(
          isFailure ? initialFailure : initial,
        );
        return [
          value,
          (next) => {
            if (isFailure)
              failure = typeof next === "function" ? next(failure) : next;
            else setValue(next);
          },
        ];
      },
    },
    "react/jsx-runtime": { ...runtime, jsx: wrap("jsx"), jsxs: wrap("jsxs") },
    "@/lib/useApplicationForm": {
      useApplicationForm(messages) {
        form = useApplicationForm(messages);
        return {
          ...form,
          trigger: (...args) => {
            validations.push(args);
            return form.trigger(...args);
          },
        };
      },
    },
    "@/lib/applicationForm": transport,
    "@/lib/applicationFeedback": feedback,
    "@/lib/phoneNumber": phone,
    "@/lib/publicSite": { publicSiteClass: "public-site" },
    "@/lib/applicationPhoneCountries": {
      getApplicationPhoneCountryOptions: () => [
        { country: "PH", name: "Philippines", code: "63" },
        { country: "TW", name: "Taiwan", code: "886" },
        { country: "DE", name: "Germany", code: "49" },
        { country: "GB", name: "United Kingdom", code: "44" },
      ],
      isApplicationPhoneCountry: (c) =>
        ["PH", "TW", "DE", "GB"].includes(c),
    },
    "../ui/sheet": {
      Sheet: element("div"),
      SheetTrigger: () => null,
      SheetContent: element("div", "sheet-content"),
      SheetClose: element("button"),
      SheetTitle: element("h2", "sheet-title"),
      SheetDescription: element("p"),
    },
    "@/components/ui/button": {
      Button({ type, variant, className, disabled, children, ...rest }) {
        return React.createElement(
          "button",
          { type, "data-variant": variant, className, disabled, ...rest },
          children,
        );
      },
    },
    "@/components/ui/input": {
      Input: React.forwardRef(function Input(props, ref) {
        return React.createElement("input", { ...props, ref });
      }),
    },
    "@/components/ui/textarea": {
      Textarea: React.forwardRef(function Textarea(props, ref) {
        return React.createElement("textarea", { ...props, ref });
      }),
    },
    "@/components/ui/label": {
      Label({ className, htmlFor, children, ...rest }) {
        return React.createElement(
          "label",
          { className, htmlFor, ...rest },
          children,
        );
      },
    },
    "@/components/ui/checkbox": {
      Checkbox({
        onCheckedChange,
        inputRef,
        className,
        id,
        name,
        checked,
        required,
        "aria-invalid": ariaInvalid,
        "aria-describedby": ariaDescribedBy,
        onBlur,
      }) {
        return React.createElement("input", {
          ref: inputRef,
          id,
          type: "checkbox",
          className,
          name,
          checked,
          required,
          "aria-invalid": ariaInvalid,
          "aria-describedby": ariaDescribedBy,
          onChange: (e) => onCheckedChange?.(e.target.checked),
          onBlur,
        });
      },
    },
    "@/components/ui/select": {
      Select({ children }) {
        return React.createElement("div", { "data-slot": "select" }, children);
      },
      SelectTrigger({ id, className, children, ...rest }) {
        return React.createElement(
          "button",
          { id, type: "button", className, ...rest },
          children,
        );
      },
      SelectValue({ children }) {
        return React.createElement("span", null, children);
      },
      SelectContent({ children }) {
        return React.createElement("div", { "data-slot": "select-content" }, children);
      },
      SelectItem({ value, children }) {
        return React.createElement("div", { "data-value": value }, children);
      },
    },
  };
  const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => (Object.hasOwn(mocks, id) ? mocks[id] : require(id)),
    compiled,
    compiled.exports,
  );
  const html = renderToStaticMarkup(
    React.createElement(compiled.exports.ApplicationDrawer, {
      locale,
      content: applicationContent[locale],
      jobId: "job",
      jobTitle: "Customer Operations Lead",
      applyLabel: "Apply",
      endpoints: {
        upload: "/api/applications/uploads",
        applications: "/api/applications",
      },
    }),
  );
  const unsubscribe = form.subscribe({
    formState: { values: true },
    callback() {},
  });
  return {
    html,
    form,
    elements,
    validations,
    unsubscribe,
    failure: () => failure,
  };
}

for (const locale of ["en", "zh"]) {
  test(`${locale}: correcting fields cannot reopen a confirmed closed job`, async (t) => {
    const f = drawerFixture(locale, "closed");
    t.after(f.unsubscribe);
    assert.ok(f.html.includes(applicationContent[locale].closed));
    assert.match(f.html, /<button[^>]*type="submit"[^>]*disabled=""/);
    f.elements.get("apply-name").onInput();
    f.elements.get("apply-email").onInput();
    f.elements.get("apply-phone").onInput();
    f.elements.get("apply-cover-letter").onInput();
    f.form.setValue("phoneCountry", "PH");
    f.elements.get("apply-resume").onChange({
      target: {
        files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })],
      },
    });
    assert.equal(f.failure(), "closed");
    const editable = drawerFixture(locale, "unavailable");
    t.after(editable.unsubscribe);
    editable.elements.get("apply-phone").onInput();
    assert.equal(editable.failure(), null);
  });
  test(`${locale}: drawer has labelled country selection and international paste`, async (t) => {
    const f = drawerFixture(locale);
    t.after(f.unsubscribe);
    const phoneInput = f.elements.get("apply-phone");
    assert.equal(phoneInput.inputMode, "tel");
    assert.equal(phoneInput.autoComplete, "tel");
    assert.equal(phoneInput["aria-describedby"], undefined);
    assert.ok(f.html.includes('for="apply-phone-country"'));
    assert.ok(f.html.includes('data-value="PH"'));
    assert.ok(f.html.includes('data-value="TW"'));
    assert.ok(f.html.includes('data-value="DE"'));
    assert.ok(!f.html.includes("apply-phone-hint"));
    f.form.setValue("phoneCountry", "PH");
    const input = { name: "phone", type: "tel", value: "", focus() {} };
    f.form.register("phone").ref(input);
    f.form.setValue("phone", "+44 20 7946 0018");
    phoneInput.onBlur({ target: input, type: "blur" });
    assert.equal(f.form.getValues("phoneCountry"), "GB");
    assert.equal(
      phone.parsePhoneNumber(
        f.form.getValues("phone"),
        f.form.getValues("phoneCountry"),
      ).number,
      "+442079460018",
    );
    f.form.setValue("phoneCountry", "PH");
    f.form.setValue("phone", "9123456789");
    assert.equal(await f.form.trigger("phone"), true);
    f.form.setValue("phone", "+0164536156465");
    assert.equal(await f.form.trigger("phone"), false);
    assert.equal(
      f.form.getFieldState("phone").error.message,
      applicationContent[locale].validation.phone,
    );
  });
  test(`${locale}: choosing a country does not validate an untouched empty phone field`, async (t) => {
    const f = drawerFixture(locale);
    t.after(f.unsubscribe);
    f.form.setValue("phoneCountry", "PH");
    assert.deepEqual(f.validations, []);
    assert.equal(f.form.getFieldState("phone").error, undefined);
    f.form.setValue("phone", "9123456789");
    assert.equal(await f.form.trigger("phone"), true);
    f.form.setValue("phone", "");
    let invalid;
    await f.form.handleSubmit(
      () => assert.fail("Empty phone must not submit"),
      (errors) => {
        invalid = errors;
      },
    )();
    assert.equal(
      invalid.phone.message,
      applicationContent[locale].validation.phoneRequired,
    );
  });
}
