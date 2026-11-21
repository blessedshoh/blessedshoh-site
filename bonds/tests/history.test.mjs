// The window history behind the Factors tab: one query, pivoted to a row per day, with nulls
// where the Treasury did not publish a maturity.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PCA_TENORS, cachedHistory, historyPayload, windowStart } from "../src/lib/history-data.ts";

function fakeDb(day, rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      return {
        bind(...args) {
          call.binds = args;
          return this;
        },
        async first() {
          return { day };
        },
        async all() {
          return { results: sql.includes("BETWEEN") ? rows : [] };
        },
      };
    },
  };
}

const row = (day, tenor, yield_pct) => ({ day, tenor, yield_pct });

test("a five-year window pivots stored rows into one row per day, nulls where unpublished", async () => {
  const rows = [
    row("2021-11-22", "3 Mo", 0.05),
    row("2021-11-22", "30 Yr", 1.98),
    row("2021-11-23", "3 Mo", 0.06),
    row("2021-11-23", "20 Yr", 2.01),
    row("2021-11-23", "30 Yr", 2.0),
  ];
  const result = await historyPayload(fakeDb("2026-11-20", rows), "2026-11-20", "5", "2026-11-21");
  assert.equal(result.status, 200);
  const body = result.body;
  assert.deepEqual(body.tenors, [...PCA_TENORS]);
  assert.deepEqual(body.days, ["2021-11-22", "2021-11-23"]);
  assert.equal(body.yields[0][0], 0.05);
  assert.equal(body.yields[0][PCA_TENORS.indexOf("20 Yr")], null);
  assert.equal(body.yields[1][PCA_TENORS.indexOf("20 Yr")], 2.01);
  assert.equal(body.yields[0][9], 1.98);
  assert.equal(body.day, "2026-11-20");
  assert.equal(body.years, 5);
  assert.equal(body.from, "2021-11-22");
});

test("years must be 1, 2, 5 or 10, and the day a real date", async () => {
  const db = fakeDb("2026-11-20", []);
  assert.equal((await historyPayload(db, "2026-11-20", "3", "2026-11-21")).status, 400);
  assert.equal((await historyPayload(db, "2026-11-20", "abc", "2026-11-21")).status, 400);
  assert.equal((await historyPayload(db, "2026-02-30", "5", "2026-11-21")).status, 400);
  assert.equal((await historyPayload(db, "1989-12-29", "5", "2026-11-21")).status, 400);
  assert.equal((await historyPayload(db, "2027-01-04", "5", "2026-11-21")).status, 400);
});

test("a window reaching before 1990 starts at the first stored day", async () => {
  const rows = [row("1990-01-02", "6 Mo", 7.89), row("1990-01-03", "6 Mo", 7.94)];
  const result = await historyPayload(fakeDb("1990-06-29", rows), "1990-06-29", "10", "2026-11-21");
  assert.equal(result.status, 200);
  assert.equal(result.body.from, "1990-01-02");
});

test("one query, bounded by the window and the ten tenors", async () => {
  const db = fakeDb("2026-11-20", [row("2024-11-20", "3 Mo", 4.5)]);
  await historyPayload(db, "2026-11-23", "2", "2026-11-23");
  const query = db.calls.find((c) => c.sql.includes("BETWEEN"));
  assert.ok(query);
  assert.equal(db.calls.filter((c) => c.sql.includes("BETWEEN")).length, 1);
  assert.deepEqual(query.binds.slice(0, 2), ["2024-11-20", "2026-11-20"]);
  assert.deepEqual(query.binds.slice(2), [...PCA_TENORS]);
  assert.equal(PCA_TENORS.length, 10);
});

test("no stored rows in the window is a 404", async () => {
  const result = await historyPayload(fakeDb("2026-11-20", []), null, "1", "2026-11-21");
  assert.equal(result.status, 404);
});

test("windowStart keeps month and day, with 29 February moving to the 28th", () => {
  assert.equal(windowStart("2026-11-20", 5), "2021-11-20");
  assert.equal(windowStart("2024-02-29", 1), "2023-02-28");
  assert.equal(windowStart("2024-02-29", 2), "2022-02-28");
  assert.equal(windowStart("2024-02-29", 10), "2014-02-28");
});

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(key) {
      return store.get(key)?.clone();
    },
    async put(key, response) {
      store.set(key, response);
    },
  };
}

test("a cached window answers without the big query, keyed on the resolved day and length", async () => {
  const cache = fakeCache();
  const rows = [row("2025-11-20", "3 Mo", 4.5)];
  const first = fakeDb("2026-11-20", rows);
  const a = await cachedHistory(first, "2026-11-22", "1", "2026-11-23", cache);
  assert.equal(a.status, 200);
  assert.deepEqual([...cache.store.keys()], ["https://bonds.internal/history/2026-11-20/1"]);
  const second = fakeDb("2026-11-20", rows);
  const b = await cachedHistory(second, "2026-11-21", "1", "2026-11-23", cache);
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), await a.json());
  assert.equal(second.calls.filter((c) => c.sql.includes("BETWEEN")).length, 0);
});

test("errors are never cached", async () => {
  const cache = fakeCache();
  const response = await cachedHistory(fakeDb("2026-11-20", []), "2026-11-20", "3", "2026-11-23", cache);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(cache.store.size, 0);
});
