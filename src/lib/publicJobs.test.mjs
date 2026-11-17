import assert from "node:assert/strict";
import test from "node:test";
import { homeJobs } from "./homeJobs.ts";
import { parsePublicJobs } from "./publicJobSchema.ts";
import {
  emptyJobFilters,
  filterPublicJobs,
  getJobOptions,
  paginatePublicJobs,
} from "./publicJobs.ts";

// Exercise mixed-language search and combinations that can silently hide vacancies.
// These behaviours must remain consistent when backend summaries replace fixtures.
test("title search matches either translation and combines every selected facet", () => {
  assert.equal(
    filterPublicJobs(homeJobs, {
      ...emptyJobFilters,
      query: "  BILINGUAL  ",
    })[0].id,
    "1045",
  );
  assert.equal(
    filterPublicJobs(homeJobs, { ...emptyJobFilters, query: "客服专员" })[0].id,
    "1045",
  );
  assert.deepEqual(
    filterPublicJobs(homeJobs, {
      ...emptyJobFilters,
      query: "support",
      department: "Customer Operations",
      location: "Manila",
      type: "Full-time",
    }).map((job) => job.id),
    ["1045"],
  );
  assert.equal(
    filterPublicJobs(homeJobs, {
      ...emptyJobFilters,
      query: "support",
      location: "London",
    }).length,
    0,
  );
  assert.equal(filterPublicJobs(homeJobs, emptyJobFilters).length, 8);
});

// Exercise optional experience and page boundaries with synthetic public summaries.
// Missing experience is never invented and filtering must happen before pagination.
test("experience filtering combines with other facets and pagination clamps safely", () => {
  const jobs = Array.from({ length: 23 }, (_, index) => ({
    ...homeJobs[0],
    id: String(index),
    experience: index % 2 ? { en: "Senior", zh: "资深" } : null,
  }));
  const filtered = filterPublicJobs(jobs, {
    ...emptyJobFilters,
    experience: "Senior",
    location: "Manila",
  });
  assert.equal(filtered.length, 11);
  assert.deepEqual(getJobOptions(jobs, "experience", "zh"), [
    { value: "Senior", label: "资深" },
  ]);
  assert.equal(paginatePublicJobs(filtered, "1").jobs.length, 10);
  assert.equal(paginatePublicJobs(filtered, "2").jobs.length, 1);
  assert.equal(paginatePublicJobs(filtered, "999").page, 2);
  for (const page of [null, "0", "-2", "Infinity", "1.5", "9999999"])
    assert.equal(paginatePublicJobs(jobs, page).page, 1);
  assert.deepEqual(paginatePublicJobs([], "2"), {
    page: 1,
    totalPages: 1,
    jobs: [],
  });
  assert.equal(
    filterPublicJobs(homeJobs, { ...emptyJobFilters, experience: "Senior" })
      .length,
    0,
  );
});

// Keep dynamic options independent of the selected display language.
// New backend teams and locations must not require hardcoded dropdown changes.
test("facet values are unique and stable while labels are translated", () => {
  const options = getJobOptions(homeJobs, "location", "zh");
  assert.equal(options.length, 3);
  assert.ok(
    options.some(
      (option) => option.value === "Manila" && option.label === "马尼拉",
    ),
  );
});

// Reject malformed transport data before serializing it to a public page.
// Only validated summary fields survive, even if an upstream record contains extras.
test("API parsing strips unknown fields and accepts a genuinely empty collection", () => {
  const parsed = parsePublicJobs({
    jobs: [{ ...homeJobs[0], internalNote: "internal" }],
  });
  assert.equal("internalNote" in parsed[0], false);
  assert.deepEqual(parsePublicJobs({ jobs: [] }), []);
});

// Fail closed when summaries cannot produce unique, valid public destinations.
// Incorrect dates and incomplete translations should be corrected before publication.
test("API parsing rejects duplicate IDs or slugs, invalid dates and unsafe route segments", () => {
  assert.throws(() => parsePublicJobs({ jobs: [homeJobs[0], homeJobs[0]] }));
  assert.throws(() =>
    parsePublicJobs({
      jobs: [homeJobs[0], { ...homeJobs[1], slug: homeJobs[0].slug }],
    }),
  );
  for (const change of [
    { postedAt: "2026-02-30" },
    { slug: "../admin" },
    { title: { en: "Missing translation" } },
  ]) {
    assert.throws(() =>
      parsePublicJobs({ jobs: [{ ...homeJobs[0], ...change }] }),
    );
  }
  assert.throws(() => parsePublicJobs({ data: homeJobs }));
});
