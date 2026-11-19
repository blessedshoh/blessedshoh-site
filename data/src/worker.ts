// blessedshoh-data: loads the U.S. Treasury's daily par yield curve into the hub database.
// Runs on a schedule only (no routes). Each run fetches this year's file (and last year's
// in the first week of January), stores only days newer than the latest stored one, and
// writes a line to the hub's change log when something was added or a fetch failed.

import { parseTreasuryCsv, rowsFor, treasuryUrl, type TreasuryRow } from "./treasury.ts";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
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

const BATCH = 100;

async function upsert(db: Database, rows: TreasuryRow[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.batch(
      rows.slice(i, i + BATCH).map((row) =>
        db
          .prepare(
            `INSERT INTO treasury_par_yields (day, tenor, yield_pct) VALUES (?, ?, ?)
             ON CONFLICT (day, tenor) DO UPDATE SET yield_pct = excluded.yield_pct`,
          )
          .bind(row.day, row.tenor, row.yieldPct),
      ),
    );
  }
}

async function log(db: Database, summary: string) {
  await db.prepare("INSERT INTO changes (who, area, summary) VALUES ('data worker', 'data', ?)").bind(summary.slice(0, 300)).run();
}

export async function loadLatest(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<string[]> {
  const year = now.getUTCFullYear();
  const years = now.getUTCMonth() === 0 && now.getUTCDate() <= 7 ? [year - 1, year] : [year];
  const latest = (await env.DB.prepare("SELECT MAX(day) AS day FROM treasury_par_yields").first<{ day: string | null }>())?.day ?? "";
  const added: string[] = [];
  try {
    for (const y of years) {
      const response = await fetcher(treasuryUrl(y), { headers: { accept: "text/csv", "user-agent": "blessedshoh-data/1.0" } });
      if (!response.ok) throw new Error(`treasury.gov answered ${response.status} for ${y}`);
      const fresh = parseTreasuryCsv(await response.text()).filter((d) => d.day > latest);
      if (fresh.length > 0) {
        await upsert(env.DB, rowsFor(fresh));
        added.push(...fresh.map((d) => d.day));
      }
    }
  } catch (error) {
    await log(env.DB, `Treasury fetch failed: ${(error as Error).message}`);
    return [];
  }
  if (added.length > 0) await log(env.DB, `Treasury curve loaded: ${added.sort().join(", ")}`);
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
