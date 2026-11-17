import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSource } from "../helpers/compile.mjs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { jobEditorContent } from "../../../src/lib/admin/jobEditorContent.ts";
import { jobManagementContent } from "../../../src/lib/admin/jobManagementContent.ts";
import * as validation from "../../../src/lib/admin/jobValidation.ts";
import * as input from "../../../src/lib/admin/jobEditorInput.ts";
import * as feedback from "../../../src/lib/admin/jobEditorFeedback.ts";
import * as reference from "../../../src/lib/admin/referenceData.ts";
import * as status from "../../../src/lib/admin/jobStatus.ts";

// Render the actual editor with the requested wizard step. Browser navigation
// and timezone detection are supplied, while the form and disabled states are real.
function renderEditor({ locked, lang, step }) {
  const url = new URL(
    "../../../src/components/admin/JobEditor.tsx",
    import.meta.url,
  );
  let state = 0;
  const mocks = {
    react: {
      ...React,
      useState(initial) {
        return React.useState(state++ === 4 ? step : initial);
      },
    },
    "./AdminNavigation": {
      useAdminRouter: () => ({}),
      AdminLink: ({ children, href }) =>
        React.createElement("a", { href }, children),
    },
    "@/lib/admin/jobStatus": status,
    "@/lib/admin/jobEditorContent": { jobEditorContent },
    "@/lib/admin/jobManagementContent": { jobManagementContent },
    "@/lib/admin/jobClient": {},
    "@/lib/admin/jobEditorInput": input,
    "@/lib/admin/useAdminTimeZone": {
      useAdminTimeZone: () => ({
        ready: true,
        timeZone: "UTC",
        detected: "UTC",
      }),
    },
    "./TimeZonePreference": {
      TimeZonePreference: () => null,
      timeZoneContent: { en: { hint: "Timezone" }, zh: { hint: "时区" } },
    },
    "./JobRecruitingFields": { JobRecruitingFields: () => null },
    "@/lib/admin/jobValidation": validation,
    "@/lib/admin/staffClient": {},
    "@/lib/admin/referenceData": reference,
    "@/lib/admin/jobEditorFeedback": feedback,
  };
  const compiled = { exports: loadSource(fileURLToPath(url), mocks) };
  const content = {
    title: "Engineer",
    responsibilities: ["Build"],
    requirements: ["Skill"],
  };
  const option = {
    id: "option",
    code: "OPTION",
    active: true,
    label: { en: "Option", zh: "选项" },
  };
  return renderToStaticMarkup(
    React.createElement(compiled.exports.JobEditor, {
      job: {
        id: "job",
        slug: "engineer",
        status: "draft",
        version: 1,
        settingsLocked: locked,
        draft: {
          en: content,
          zh: content,
          settings: {
            departmentId: "option",
            locationIds: ["option"],
            jobType: "OPTION",
            experience: "OPTION",
            salary: { min: 0, max: 10, currency: "USD", period: "MONTH" },
            showSalary: true,
            publishAt: null,
            closeAt: null,
          },
        },
      },
      settings: {
        departments: [option],
        locations: [option],
        jobTypes: [option],
        experienceLevels: [option],
      },
      lang,
      isNew: false,
      canEdit: true,
      canPublish: true,
    }),
  );
}

for (const lang of ["en", "zh"]) {
  test(`${lang}: all Page 2 values lock while translations and save actions remain editable`, () => {
    for (const locked of [false, true]) {
      const html = renderEditor({ locked, lang, step: 2 });
      const fields = html.match(/<(?:input|select)\b[^>]*>/g);
      assert.ok(fields.length >= 12);
      assert.equal(
        fields.every((field) => field.includes('disabled=""')),
        locked,
      );
      assert.ok(
        html.includes(
          locked
            ? jobEditorContent[lang].settingsLockedNote
            : jobEditorContent[lang].settingsLockNote,
        ),
      );
    }
    const translations = renderEditor({ locked: true, lang, step: 1 }).match(
      /<(?:input|textarea)\b[^>]*>/g,
    );
    assert.equal(translations.length, 3);
    assert.ok(translations.every((field) => !field.includes('disabled=""')));
    const review = renderEditor({ locked: true, lang, step: 3 });
    assert.ok(review.includes(jobEditorContent[lang].saveDraft));
    assert.ok(!review.match(/<button\b[^>]*disabled=""/));
  });
}
