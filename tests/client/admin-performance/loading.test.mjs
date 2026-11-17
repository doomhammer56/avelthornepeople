import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadSource } from "../helpers/compile.mjs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { isAccessError } from "../../../src/lib/admin/queryClient.ts";

// Compile the actual TSX for Node's renderer without starting Next or a database.
// Only browser hooks and the session check's initial state are supplied by the test.
function loadComponent(name, mocks) {
  const url = new URL(
    `../../../src/components/admin/${name}.tsx`,
    import.meta.url,
  );
  return loadSource(fileURLToPath(url), mocks);
}

// Presentational shadcn primitives are irrelevant to these behavior tests; the
// component under test only needs something renderable for each import.
const passthrough = (tag) => (props) =>
  React.createElement(tag, { className: props.className, role: props.role }, props.children);
const uiStubs = {
  "@/components/ui/button": { Button: passthrough("button") },
  "@/components/ui/card": { Card: passthrough("div") },
  "@/components/ui/alert": {
    Alert: passthrough("div"),
    AlertDescription: passthrough("div"),
  },
};

function skeletonFor(pathname, lang = "en") {
  return loadComponent("AdminPageSkeleton", {
    "./AdminNavigation": { useAdminLoading() {} },
    "next/navigation": {
      usePathname: () => pathname,
      useSearchParams: () => new URLSearchParams({ lang }),
    },
  });
}

test("tab-resume checks keep the shell visible and hide only the mounted page", () => {
  const skeleton = skeletonFor("/admin/jobs");
  const gate = loadComponent("AdminSessionGate", {
    ...uiStubs,
    "./AdminPageSkeleton": skeleton,
  });
  for (const [checking, admissionFailed] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const client = new QueryClient();
    let state = 0;
    const { AdminQueryProvider } = loadComponent("AdminQueryProvider", {
      react: {
        ...React,
        useState(initial) {
          const values = [
            admissionFailed,
            checking,
            { client, setAccessHandler() {} },
          ];
          return [state < values.length ? values[state++] : initial, () => {}];
        },
      },
      "./AdminSessionGate": gate,
      "@/lib/admin/queryClient": {},
      "@/lib/admin/queries": {},
      "@/lib/admin/cachePolicy": {},
      "@/lib/admin/admission": {},
    });
    const html = renderToStaticMarkup(
      React.createElement(
        AdminQueryProvider,
        {
          staff: { id: "staff", role: "ADMIN" },
          lang: "en",
        },
        React.createElement(
          "div",
          { className: "admin-shell" },
          React.createElement("aside", null, "Sidebar"),
          React.createElement(
            "main",
            null,
            React.createElement(
              gate.AdminSessionGate,
              { lang: "en" },
              React.createElement("input", { defaultValue: "Unsaved draft" }),
            ),
          ),
        ),
      ),
    );
    // No hidden ancestor around the shell. Draft content remains mounted inside
    // the gate, rather than being discarded during a temporary session check.
    assert.ok(
      html.startsWith('<div class="admin-shell"><aside>Sidebar</aside><main>'),
    );
    assert.match(html, /value="Unsaved draft"/);
    assert.equal(
      html.includes('class="admin-session-content" hidden=""'),
      checking || admissionFailed,
    );
    assert.equal(
      html.includes('data-skeleton="jobs"'),
      checking && !admissionFailed,
    );
    assert.equal(html.includes('role="alert"'), admissionFailed);
    client.clear();
  }
});

test("route fallbacks select page structures and keep placeholders inaccessible", () => {
  for (const [path, variant] of [
    ["/admin", "dashboard"],
    ["/admin/jobs", "jobs"],
    ["/admin/jobs/new", "editor"],
    ["/admin/jobs/123/edit", "editor"],
    ["/admin/applications", "applications"],
    ["/admin/applications/123", "detail"],
    ["/admin/accounts", "accounts"],
    ["/admin/settings", "settings"],
    ["/admin/log", "audit"],
    ["/admin/content", "content"],
  ]) {
    const { AdminPageSkeleton } = skeletonFor(path, "zh");
    const html = renderToStaticMarkup(React.createElement(AdminPageSkeleton));
    assert.ok(html.includes(`data-skeleton="${variant}"`), path);
    assert.match(html, /role="status" aria-busy="true"/);
    assert.match(html, /正在加载…/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /<(input|button|select)\b/);
  }
});

test("the Applications data fallback does not duplicate its server-rendered header", () => {
  const { AdminPageSkeleton } = skeletonFor("/admin/applications");
  const html = renderToStaticMarkup(
    React.createElement(AdminPageSkeleton, {
      variant: "applications",
      showHeader: false,
    }),
  );
  assert.doesNotMatch(html, /data-skeleton-part="header"/);
  assert.match(html, /data-skeleton-part="pipeline"/);
  assert.match(html, /repeat\(5, minmax\(80px, 1fr\)\)/);
});

test("an explicit destination variant wins while navigation still reports the old path", () => {
  const { AdminPageSkeleton } = skeletonFor("/admin");
  const html = renderToStaticMarkup(
    React.createElement(AdminPageSkeleton, { variant: "editor" }),
  );
  assert.match(html, /data-skeleton="editor"/);
  assert.match(html, /data-skeleton-part="steps"/);
  assert.doesNotMatch(html, /data-skeleton-part="kpis"/);
});

test("denied refreshes discard component snapshots; temporary outages retain them", () => {
  const previous = { label: "Previously loaded private data" };
  for (const status of [401, 403, 503]) {
    const updates = [];
    const { useAdminQuerySnapshot } = loadComponent("AdminQueryFeedback", {
      ...uiStubs,
      react: {
        ...React,
        useState: () => [previous, (value) => updates.push(value)],
      },
      "@/lib/admin/queryClient": { isAccessError },
    });
    function Result() {
      const snapshot = useAdminQuerySnapshot(undefined, false, { status });
      return React.createElement("p", null, snapshot?.label ?? "No data");
    }
    const html = renderToStaticMarkup(React.createElement(Result));
    if (status === 503) {
      assert.match(html, /Previously loaded private data/);
      assert.deepEqual(updates, []);
    } else {
      assert.doesNotMatch(html, /Previously loaded private data/);
      assert.deepEqual(updates, [undefined]);
    }
  }
});

test("signing out or losing access shows a redirect state, never the verification error", () => {
  const gate = loadComponent("AdminSessionGate", {
    ...uiStubs,
    "./AdminPageSkeleton": skeletonFor("/admin"),
  });
  const render = (state) =>
    renderToStaticMarkup(
      React.createElement(
        gate.AdminSessionContext.Provider,
        { value: { checking: false, admissionFailed: false, ...state } },
        React.createElement(
          gate.AdminSessionGate,
          { lang: "en" },
          React.createElement("p", null, "Page"),
        ),
      ),
    );
  const redirecting = render({ redirecting: true });
  assert.match(redirecting, /Redirecting…/);
  assert.match(redirecting, /role="status"/);
  assert.doesNotMatch(redirecting, /Unable to verify your session/);
  assert.match(redirecting, /class="admin-session-content" hidden=""/);
  // A genuine verification failure still offers a retry.
  const failed = render({ admissionFailed: true });
  assert.match(failed, /Unable to verify your session/);
  assert.doesNotMatch(failed, /Redirecting…/);
});
