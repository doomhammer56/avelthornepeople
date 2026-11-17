import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  renderToReadableStream,
  registerClientReference,
} from "next/dist/compiled/react-server-dom-webpack/server.node.js";
import { applicationContent } from "../../../src/lib/applicationContent.ts";

// Exercise the React Flight boundary used by JobDetailPage -> ApplicationDrawer.
// Rendering a Client Component directly as HTML cannot catch nonserializable props.
const ApplicationDrawer = registerClientReference(
  function ApplicationDrawer() {},
  "application-drawer",
  "ApplicationDrawer",
);
const manifest = {
  "application-drawer#ApplicationDrawer": {
    id: "drawer",
    chunks: [],
    name: "ApplicationDrawer",
  },
};

for (const locale of ["en", "zh"]) {
  test(`${locale}: job application props serialize through the server/client boundary`, async () => {
    const errors = [];
    const stream = renderToReadableStream(
      React.createElement(ApplicationDrawer, {
        locale,
        content: applicationContent[locale],
        jobId: "job",
        jobTitle: "Engineer",
        applyLabel: "Apply",
        endpoints: {
          upload: "/api/applications/uploads",
          applications: "/api/applications",
        },
      }),
      manifest,
      {
        onError(error) {
          errors.push(error.message);
          return "serialization-error";
        },
      },
    );
    const payload = await new Response(stream).text();
    assert.deepEqual(errors, []);
    assert.ok(payload.includes(applicationContent[locale].retryAfter));
    assert.ok(!payload.includes("serialization-error"));
    const retryMessage = applicationContent[locale].retryAfter.replace(
      "{seconds}",
      "90",
    );
    assert.ok(retryMessage.includes("90"));
    assert.ok(!retryMessage.includes("{seconds}"));
  });
}
