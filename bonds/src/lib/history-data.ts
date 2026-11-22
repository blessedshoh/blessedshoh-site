// The stored par yields for a PCA window, as /history.json serves them to the Factors tab.
// Reads the hub database only, and computes nothing: the rows are pivoted to one per day,
// with null where the Treasury did not publish a maturity. bondlab picks the tenor set.
//
// D1's free tier allows 5,000,000 row reads a day for the whole account, and a ten-year
// window is about 30,000 rows (the query scans every stored maturity in its range). So the
// data is read and cached a calendar year at a time: a past year never changes and is cached
// whole, and the current year is one block keyed on the latest stored day. Any window is
// then assembled from at most eleven cached blocks, and the blocks a colo can ever miss on
// are bounded (one per year since 1990, plus one for the current year each day).

import type { Database } from "@blessedshoh/kit/hub-data";
import { FIRST_DAY, dayOnOrBefore, latestDay, yieldsBetween } from "@blessedshoh/kit/treasury-data";
import { isIsoDay } from "./state.ts";
import { FACTOR_YEARS } from "./types.ts";

/** The candidate maturities for the PCA: 3 months to 30 years, in maturity order. */
export const PCA_TENORS = ["3 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"] as const;
export const WINDOW_YEARS = FACTOR_YEARS;
export type WindowYears = (typeof WINDOW_YEARS)[number];

export interface StoredHistory {
  /** The window's last day: the stored day on or before the one asked for. */
  day: string;
  years: WindowYears;
  /** The first stored day in the window (later than `years` back when the data starts later). */
  from: string;
  tenors: string[];
  days: string[];
  /** Percent; null where that maturity was not published that day. */
  yields: (number | null)[][];
}

export type HistoryResult = { status: 200; body: StoredHistory } | { status: 400 | 404 | 503; body: { error: string } };

/** The part of the Workers Cache API used here; absent outside a Worker. */
export interface WindowCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/** One calendar year of stored rows, pivoted. */
interface Block {
  days: string[];
  yields: (number | null)[][];
}

const ONE_DAY = 86_400;
const THIRTY_DAYS = 30 * ONE_DAY;
const FIRST_YEAR = Number(FIRST_DAY.slice(0, 4));

/** The same month and day `years` earlier; 29 February becomes the 28th in a common year. */
export function windowStart(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const year = y - years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lastDay = m === 2 ? (leap ? 29 : 28) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

type Resolved = { status: 200; day: string; latest: string; years: WindowYears } | { status: 400 | 404 | 503; body: { error: string } };

/** Check the request and find the window's last stored day and the latest stored day: two small reads. */
async function resolveWindow(db: Database, requested: string | null, years: string | null, today: string): Promise<Resolved> {
  const length = Number(years ?? "5");
  if (!(WINDOW_YEARS as readonly number[]).includes(length)) {
    return { status: 400, body: { error: `years must be one of ${WINDOW_YEARS.join(", ")}; received ${JSON.stringify(years)}` } };
  }
  if (requested !== null) {
    if (!isIsoDay(requested)) return { status: 400, body: { error: `${JSON.stringify(requested)} is not a date (YYYY-MM-DD)` } };
    if (requested < FIRST_DAY) return { status: 400, body: { error: `Treasury data here starts on ${FIRST_DAY} (1990)` } };
    if (requested > today) return { status: 400, body: { error: `${requested} is in the future` } };
  }
  const latest = await latestDay(db);
  if (latest === null) return { status: 503, body: { error: "no Treasury data has been loaded yet" } };
  const day = requested === null ? latest : await dayOnOrBefore(db, requested, today);
  if (day === null) return { status: 404, body: { error: `no Treasury data on or before ${requested}` } };
  return { status: 200, day, latest, years: length as WindowYears };
}

/** Read one calendar year (up to `last` for the current year) and pivot it: the one large read. */
async function readBlock(db: Database, year: number, last: string): Promise<Block> {
  const end = `${year}-12-31` < last ? `${year}-12-31` : last;
  const rows = await yieldsBetween(db, `${year}-01-01`, end, PCA_TENORS);
  const days: string[] = [];
  const yields: (number | null)[][] = [];
  for (const row of rows) {
    if (days.at(-1) !== row.day) {
      days.push(row.day);
      yields.push(PCA_TENORS.map(() => null));
    }
    const column = (PCA_TENORS as readonly string[]).indexOf(row.tenor);
    if (column >= 0) yields[yields.length - 1][column] = row.yield_pct;
  }
  return { days, yields };
}

/** A year's block from the cache, or read and cached: past years for thirty days, the current year for one. */
async function block(db: Database, year: number, latest: string, cache: WindowCache | null, origin: string): Promise<Block> {
  const current = year === Number(latest.slice(0, 4));
  const key = current ? `${origin}/__history/block/${year}/${latest}` : `${origin}/__history/block/${year}`;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return (await hit.json()) as Block;
  const fresh = await readBlock(db, year, latest);
  if (cache) {
    const maxAge = current ? ONE_DAY : THIRTY_DAYS;
    await cache.put(key, Response.json(fresh, { headers: { "cache-control": `public, max-age=${maxAge}` } }));
  }
  return fresh;
}

async function assemble(
  db: Database,
  resolved: { day: string; latest: string; years: WindowYears },
  cache: WindowCache | null,
  origin: string,
): Promise<HistoryResult> {
  const { day, latest, years } = resolved;
  const start = windowStart(day, years);
  const days: string[] = [];
  const yields: (number | null)[][] = [];
  for (let year = Math.max(FIRST_YEAR, Number(start.slice(0, 4))); year <= Number(day.slice(0, 4)); year++) {
    const part = await block(db, year, latest, cache, origin);
    part.days.forEach((d, i) => {
      if (d >= start && d <= day) {
        days.push(d);
        yields.push(part.yields[i]);
      }
    });
  }
  if (days.length === 0) return { status: 404, body: { error: `no Treasury data in the ${years}-year window ending ${day}` } };
  return { status: 200, body: { day, years, from: days[0], tenors: [...PCA_TENORS], days, yields } };
}

/** The window's history without a cache (tests, and any caller outside a Worker). */
export async function historyPayload(db: Database, requested: string | null, years: string | null, today: string): Promise<HistoryResult> {
  const resolved = await resolveWindow(db, requested, years, today);
  return resolved.status === 200 ? assemble(db, resolved, null, "") : resolved;
}

/** The /history.json response, built from year blocks cached under the site's own origin. Errors are not cached. */
export async function cachedHistory(
  db: Database,
  requested: string | null,
  years: string | null,
  today: string,
  cache: WindowCache | null,
  origin: string,
): Promise<Response> {
  const fail = (status: number, body: { error: string }) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const resolved = await resolveWindow(db, requested, years, today);
  if (resolved.status !== 200) return fail(resolved.status, resolved.body);
  const result = await assemble(db, resolved, cache, origin);
  if (result.status !== 200) return fail(result.status, result.body);
  return Response.json(result.body, { headers: { "cache-control": `public, max-age=${ONE_DAY}` } });
}
