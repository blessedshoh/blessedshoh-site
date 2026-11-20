// Treasury par-yield parsing and the stored-day lookup the bonds site uses.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTreasuryCsv, rowsFor } from "../src/treasury.ts";
import { dayOnOrBefore, yieldsFor } from "../../kit/treasury-data.ts";

const Y1990 = 'Date,"3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","30 Yr"\n12/31/1990,6.63,6.73,6.82,7.15,7.40,7.68,8.00,8.08,8.26\n';
const Y2004 = 'Date,"1 Mo","3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr"\n12/31/2004,1.89,2.22,2.59,2.75,3.08,3.25,3.63,3.94,4.24,4.85\n';
const Y2026 =
  'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"\n' +
  "11/18/2026,4.10,4.24,4.27,4.34,4.35,4.43,4.62,4.80,4.84,4.89,4.96,5.07,5.44,5.41\n" +
  "11/17/2026,4.09,4.24,4.26,4.33,4.32,4.41,4.60,4.80,4.84,4.90,4.99,5.10,5.50,5.46\n";

test("columns are read by header, whatever the year", () => {
  const [d1990] = parseTreasuryCsv(Y1990);
  assert.equal(d1990.day, "1990-12-31");
  assert.equal(d1990.yields["30 Yr"], 8.26);
  assert.equal("1 Mo" in d1990.yields, false);
  const [d2004] = parseTreasuryCsv(Y2004);
  assert.equal("30 Yr" in d2004.yields, false);
  const days = parseTreasuryCsv(Y2026);
  assert.deepEqual(days.map((d) => d.day), ["2026-11-18", "2026-11-17"]);
  assert.equal(days[0].yields["1.5 Month"], 4.24);
  assert.equal(Object.keys(days[0].yields).length, 14);
});

test("an HTML error page is not a CSV", () => {
  assert.throws(() => parseTreasuryCsv("<html><body>Service unavailable</body></html>"), /not a Treasury par-yield CSV/);
});

test("an empty year gives no days", () => {
  assert.deepEqual(parseTreasuryCsv('Date,"1 Mo","3 Mo"\n'), []);
});

test("unknown maturities and bad numbers are named", () => {
  assert.throws(() => parseTreasuryCsv('Date,"9 Mo"\n01/02/2026,4\n'), /9 Mo/);
  assert.throws(() => parseTreasuryCsv('Date,"1 Mo"\n01/02/2026,abc\n'), /line 2/);
});

test("rows flatten one day into one row per maturity", () => {
  const rows = rowsFor(parseTreasuryCsv(Y2004));
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], { day: "2004-12-31", tenor: "1 Mo", yieldPct: 1.89 });
});

// A database stand-in that answers the one query each lookup makes.
function fakeDb(answer) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return this;
        },
        async first() {
          return answer;
        },
        async all() {
          return { results: answer ?? [] };
        },
        async run() {
          return {};
        },
      };
    },
  };
}

test("a weekend date reads the last stored day before it", async () => {
  const db = fakeDb({ day: "2026-11-13" });
  assert.equal(await dayOnOrBefore(db, "2026-11-15", "2026-11-20"), "2026-11-13");
  assert.deepEqual(db.calls[0].values, ["2026-11-15"]);
});

test("dates before 1990 or in the future are refused without a query", async () => {
  const db = fakeDb({ day: "2026-11-18" });
  assert.equal(await dayOnOrBefore(db, "1989-12-29", "2026-11-20"), null);
  assert.equal(await dayOnOrBefore(db, "2026-11-21", "2026-11-20"), null);
  assert.equal(await dayOnOrBefore(db, "not a date", "2026-11-20"), null);
  assert.equal(db.calls.length, 0);
});

test("yields for a day come back keyed by maturity", async () => {
  const db = fakeDb([
    { tenor: "10 Yr", yield_pct: 5.07 },
    { tenor: "2 Yr", yield_pct: 4.8 },
  ]);
  assert.deepEqual(await yieldsFor(db, "2026-11-18"), { "10 Yr": 5.07, "2 Yr": 4.8 });
});

// --- the scheduled load (fetch and database both stand-ins) ---------------------

import { loadLatest } from "../src/worker.ts";

// stored: { day: number of maturities stored }. failOnBatch: the 1-based batch that throws.
function recordingDb(stored, failOnBatch = 0) {
  const batches = [];
  const logs = [];
  let calls = 0;
  const statement = (sql) => ({
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    async all() {
      const from = this.values[0];
      return { results: Object.entries(stored).filter(([day]) => day >= from).map(([day, n]) => ({ day, n })) };
    },
    async run() {
      if (sql.startsWith("INSERT INTO changes")) logs.push(this.values[0]);
      return {};
    },
  });
  return {
    batches,
    logs,
    get writes() {
      return batches.flat();
    },
    prepare: statement,
    async batch(statements) {
      calls += 1;
      if (calls === failOnBatch) throw new Error("D1 is unavailable");
      batches.push(statements.map((s) => s.values));
    },
  };
}

test("the scheduled load stores only newer days and logs them", async () => {
  const db = recordingDb({ "2026-11-17": 14 });
  const fetcher = async () => new Response(Y2026, { status: 200 });
  const added = await loadLatest({ DB: db }, new Date("2026-11-19T23:30:00Z"), fetcher);
  assert.deepEqual(added, ["2026-11-18"]);
  assert.equal(db.writes.length, 14);
  assert.match(db.logs[0], /Treasury curve loaded: 2026-11-18/);
});

test("an HTML error page stores nothing and logs the failure", async () => {
  const db = recordingDb({ "2026-11-17": 14 });
  const fetcher = async () => new Response("<html>Temporarily unavailable</html>", { status: 200 });
  assert.deepEqual(await loadLatest({ DB: db }, new Date("2026-11-19T23:30:00Z"), fetcher), []);
  assert.equal(db.writes.length, 0);
  assert.match(db.logs[0], /Treasury fetch failed: not a Treasury par-yield CSV/);
});

test("a refused request stores nothing and logs the status", async () => {
  const db = recordingDb({ "2026-11-17": 14 });
  const fetcher = async () => new Response("", { status: 503 });
  await loadLatest({ DB: db }, new Date("2026-11-19T23:30:00Z"), fetcher);
  assert.equal(db.writes.length, 0);
  assert.match(db.logs[0], /503/);
});

test("in the first week of January last year's file is read too", async () => {
  const db = recordingDb({ "2026-12-30": 14 });
  const years = [];
  const fetcher = async (url) => {
    years.push(/csv\/(\d{4})\//.exec(url)[1]);
    return new Response('Date,"1 Mo"\n', { status: 200 });
  };
  await loadLatest({ DB: db }, new Date("2027-01-03T23:30:00Z"), fetcher);
  assert.deepEqual(years, ["2026", "2027"]);
});

const Y2026_THREE =
  Y2026 + "11/16/2026,4.08,4.23,4.25,4.32,4.31,4.40,4.59,4.79,4.83,4.89,4.98,5.09,5.49,5.45\n";
const NOV19 = new Date("2026-11-19T23:30:00Z");

test("new days are written oldest first, one transaction per day", async () => {
  const db = recordingDb({ "2026-11-13": 14 });
  const added = await loadLatest({ DB: db }, NOV19, async () => new Response(Y2026_THREE, { status: 200 }));
  assert.deepEqual(added, ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assert.deepEqual(db.batches.map((b) => [b.length, b[0][0]]), [[14, "2026-11-16"], [14, "2026-11-17"], [14, "2026-11-18"]]);
});

test("a gap below the latest stored day is filled on the next run", async () => {
  const db = recordingDb({ "2026-11-16": 14, "2026-11-18": 14 });
  const added = await loadLatest({ DB: db }, NOV19, async () => new Response(Y2026_THREE, { status: 200 }));
  assert.deepEqual(added, ["2026-11-17"]);
});

test("a day stored with maturities missing is completed", async () => {
  const db = recordingDb({ "2026-11-16": 14, "2026-11-17": 6, "2026-11-18": 14 });
  const added = await loadLatest({ DB: db }, NOV19, async () => new Response(Y2026_THREE, { status: 200 }));
  assert.deepEqual(added, ["2026-11-17"]);
  assert.equal(db.writes.length, 14);
});

test("when a write fails, the days already stored are logged with the failure", async () => {
  const db = recordingDb({}, 2);
  const added = await loadLatest({ DB: db }, NOV19, async () => new Response(Y2026_THREE, { status: 200 }));
  assert.deepEqual(added, ["2026-11-16"]);
  assert.match(db.logs.join(" | "), /Treasury curve loaded: 2026-11-16/);
  assert.match(db.logs.join(" | "), /failed.*D1 is unavailable/);
});
