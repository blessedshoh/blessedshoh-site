// blessedshoh-data: loads the U.S. Treasury's daily par yield curve into the hub database.
// Runs on a schedule only (no routes). Each run fetches this year's file (and last year's
// in the first week of January) and stores every day in it that the table lacks or holds
// only in part, so a gap left by a failed run heals on the next one. Each day is written
// in one transaction, oldest first, and the hub's change log gets a line for what was
// added and for any failure.

import { parseTreasuryCsv, rowsFor, treasuryUrl, type TreasuryDay, type TreasuryRow } from "./treasury.ts";

interface Statement {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface Database {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}
interface Env {
  DB: Database;
}
interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

/** Write one day's maturities as a single transaction, so a day is never stored in part. */
async function storeDay(db: Database, rows: TreasuryRow[]) {
  await db.batch(
    rows.map((row) =>
      db
        .prepare(
          `INSERT INTO treasury_par_yields (day, tenor, yield_pct) VALUES (?, ?, ?)
           ON CONFLICT (day, tenor) DO UPDATE SET yield_pct = excluded.yield_pct`,
        )
        .bind(row.day, row.tenor, row.yieldPct),
    ),
  );
}

/** Days in the file that the table lacks, or holds with fewer maturities than the file has. */
async function missingDays(db: Database, days: TreasuryDay[]): Promise<TreasuryDay[]> {
  if (days.length === 0) return [];
  const from = days.reduce((low, d) => (d.day < low ? d.day : low), days[0].day);
  const { results } = await db
    .prepare("SELECT day, COUNT(*) AS n FROM treasury_par_yields WHERE day >= ? GROUP BY day")
    .bind(from)
    .all<{ day: string; n: number }>();
  const stored = new Map(results.map((r) => [r.day, Number(r.n)]));
  return days.filter((d) => (stored.get(d.day) ?? 0) < Object.keys(d.yields).length);
}

async function log(db: Database, summary: string) {
  await db.prepare("INSERT INTO changes (who, area, summary) VALUES ('data worker', 'data', ?)").bind(summary.slice(0, 300)).run();
}

export async function loadLatest(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<string[]> {
  const year = now.getUTCFullYear();
  const years = now.getUTCMonth() === 0 && now.getUTCDate() <= 7 ? [year - 1, year] : [year];
  const added: string[] = [];
  let failure: string | null = null;
  try {
    for (const y of years) {
      const response = await fetcher(treasuryUrl(y), { headers: { accept: "text/csv", "user-agent": "blessedshoh-data/1.0" } });
      if (!response.ok) throw new Error(`treasury.gov answered ${response.status} for ${y}`);
      const fresh = await missingDays(env.DB, parseTreasuryCsv(await response.text()));
      for (const day of fresh.sort((a, b) => (a.day < b.day ? -1 : 1))) {
        await storeDay(env.DB, rowsFor([day]));
        added.push(day.day);
      }
    }
  } catch (error) {
    failure = (error as Error).message;
  }
  // Whatever was stored before a failure stays stored, and is logged as such.
  if (added.length > 0) await log(env.DB, `Treasury curve loaded: ${added.sort().join(", ")}`);
  if (failure !== null) await log(env.DB, `Treasury fetch failed: ${failure}`);
  return added;
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: Context) {
    ctx.waitUntil(loadLatest(env));
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
