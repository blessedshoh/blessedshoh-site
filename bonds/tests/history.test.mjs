// The window history behind the Factors tab: stored rows pivoted to one row per day, with nulls
// where the Treasury did not publish a maturity, read and cached a calendar year at a time.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PCA_TENORS, cachedHistory, historyPayload, windowStart } from "../src/lib/history-data.ts";

const ORIGIN = "https://bonds.example";

/** A fake D1: MAX(day) queries answer from `latest` and the rows; BETWEEN answers with the rows in range. */
function fakeDb(latest, rows) {
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
          if (sql.includes("WHERE day <=")) {
            const bound = call.binds[0];
            const days = rows.map((r) => r.day).filter((d) => d <= bound);
            return { day: days.length ? days.sort().at(-1) : bound <= latest ? bound : latest };
          }
          return { day: latest };
        },
        async all() {
          if (!sql.includes("BETWEEN")) return { results: [] };
          const [from, to] = call.binds;
          return { results: rows.filter((r) => r.day >= from && r.day <= to) };
        },
      };
    },
  };
}

const row = (day, tenor, yield_pct) => ({ day, tenor, yield_pct });
const big = (db) => db.calls.filter((c) => c.sql.includes("BETWEEN"));

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

test("a five-year window pivots stored rows into one row per day, nulls where unpublished", async () => {
  const rows = [
    row("2021-11-19", "3 Mo", 0.04),
    row("2021-11-22", "3 Mo", 0.05),
    row("2021-11-22", "30 Yr", 1.98),
    row("2021-11-23", "3 Mo", 0.06),
    row("2021-11-23", "20 Yr", 2.01),
    row("2021-11-23", "30 Yr", 2.0),
    row("2026-11-20", "3 Mo", 4.3),
  ];
  const result = await historyPayload(fakeDb("2026-11-20", rows), "2026-11-20", "5", "2026-11-21");
  assert.equal(result.status, 200);
  const body = result.body;
  assert.deepEqual(body.tenors, [...PCA_TENORS]);
  assert.deepEqual(body.days, ["2021-11-22", "2021-11-23", "2026-11-20"]); // 2021-11-19 is before the window
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

test("a window reaching before 1990 starts at the first stored day, and reads no year before 1990", async () => {
  const rows = [row("1990-01-02", "6 Mo", 7.89), row("1990-01-03", "6 Mo", 7.94)];
  const db = fakeDb("2026-11-20", rows);
  const result = await historyPayload(db, "1990-06-29", "10", "2026-11-21");
  assert.equal(result.status, 200);
  assert.equal(result.body.from, "1990-01-02");
  assert.deepEqual(
    big(db).map((c) => c.binds.slice(0, 2)),
    [["1990-01-01", "1990-12-31"]],
  );
});

test("the window is read a calendar year at a time, the current year up to the latest stored day", async () => {
  const db = fakeDb("2026-11-20", [row("2024-11-20", "3 Mo", 4.5), row("2026-11-20", "3 Mo", 4.3)]);
  await historyPayload(db, "2026-11-23", "2", "2026-11-23");
  assert.deepEqual(
    big(db).map((c) => c.binds.slice(0, 2)),
    [
      ["2024-01-01", "2024-12-31"],
      ["2025-01-01", "2025-12-31"],
      ["2026-01-01", "2026-11-20"],
    ],
  );
  for (const call of big(db)) assert.deepEqual(call.binds.slice(2), [...PCA_TENORS]);
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

test("year blocks are cached on the site's own origin, so other windows reuse them", async () => {
  const cache = fakeCache();
  const rows = [row("2019-06-03", "3 Mo", 2.35), row("2020-03-02", "3 Mo", 0.95), row("2020-07-01", "3 Mo", 0.14)];
  const first = fakeDb("2026-11-20", rows);
  const a = await cachedHistory(first, "2020-07-01", "1", "2026-11-23", cache, ORIGIN);
  assert.equal(a.status, 200);
  assert.deepEqual([...cache.store.keys()].sort(), [`${ORIGIN}/__history/block/2019`, `${ORIGIN}/__history/block/2020`]);
  const second = fakeDb("2026-11-20", rows);
  const b = await cachedHistory(second, "2020-03-02", "1", "2026-11-23", cache, ORIGIN);
  assert.equal(b.status, 200);
  assert.equal(big(second).length, 0);
  assert.deepEqual((await b.json()).days, ["2019-06-03", "2020-03-02"]);
});

test("the current year's block is keyed on the latest stored day, so it refreshes when a day is added", async () => {
  const cache = fakeCache();
  const rows = [row("2026-11-19", "3 Mo", 4.3), row("2026-11-20", "3 Mo", 4.31)];
  await cachedHistory(fakeDb("2026-11-20", rows), null, "1", "2026-11-23", cache, ORIGIN);
  assert.ok(cache.store.has(`${ORIGIN}/__history/block/2026/2026-11-20`));
  assert.ok(cache.store.has(`${ORIGIN}/__history/block/2025`));
});

test("errors are never cached", async () => {
  const cache = fakeCache();
  const response = await cachedHistory(fakeDb("2026-11-20", []), "2026-11-20", "3", "2026-11-23", cache, ORIGIN);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(cache.store.size, 0);
});
