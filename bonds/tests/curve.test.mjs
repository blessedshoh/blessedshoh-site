// The stored-curve endpoint: the nearest earlier day with data, labelled with its real date.
import assert from "node:assert/strict";
import { test } from "node:test";

import { curvePayload } from "../src/lib/curve-data.ts";

function fakeDb(day, yields) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          return { day };
        },
        async all() {
          return { results: sql.includes("tenor") ? yields : [] };
        },
        async run() {
          return {};
        },
      };
    },
  };
}

const YIELDS = [
  { tenor: "10 Yr", yield_pct: 4.24 },
  { tenor: "2 Yr", yield_pct: 3.08 },
];

test("a weekend date answers with the Friday before, and says so", async () => {
  const result = await curvePayload(fakeDb("2004-12-31", YIELDS), "2005-01-02", "2026-11-20");
  assert.equal(result.status, 200);
  assert.equal(result.body.day, "2004-12-31");
  assert.equal(result.body.requested, "2005-01-02");
  assert.deepEqual(result.body.yields, { "10 Yr": 4.24, "2 Yr": 3.08 });
});

test("no date means the latest stored day", async () => {
  const result = await curvePayload(fakeDb("2026-11-18", YIELDS), null, "2026-11-20");
  assert.equal(result.status, 200);
  assert.equal(result.body.day, "2026-11-18");
});

test("dates before 1990, in the future or malformed are refused", async () => {
  for (const day of ["1989-12-29", "2026-11-21", "yesterday"]) {
    const result = await curvePayload(fakeDb("2026-11-18", YIELDS), day, "2026-11-20");
    assert.equal(result.status, 400, day);
    assert.match(result.body.error, /1990|future|date/);
  }
});

test("an empty table is a 503, not a crash", async () => {
  const result = await curvePayload(fakeDb(null, []), null, "2026-11-20");
  assert.equal(result.status, 503);
});
