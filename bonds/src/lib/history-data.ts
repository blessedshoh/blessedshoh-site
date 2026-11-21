// The stored par yields for a PCA window, as /history.json serves them to the Factors tab.
// Reads the hub database only, and computes nothing: the rows are pivoted to one per day,
// with null where the Treasury did not publish a maturity. bondlab picks the tenor set.

import type { Database } from "@blessedshoh/kit/hub-data";
import { FIRST_DAY, dayOnOrBefore, latestDay, yieldsBetween } from "@blessedshoh/kit/treasury-data";
import { isIsoDay } from "./state.ts";

/** The candidate maturities for the PCA: 3 months to 30 years, in maturity order. */
export const PCA_TENORS = ["3 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"] as const;
export const WINDOW_YEARS = [1, 2, 5, 10] as const;
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

/** The same month and day `years` earlier; 29 February becomes the 28th in a common year. */
export function windowStart(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const year = y - years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lastDay = m === 2 ? (leap ? 29 : 28) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

type Resolved = { status: 200; day: string; years: WindowYears } | { status: 400 | 404 | 503; body: { error: string } };

/** Check the request and find the window's last stored day: one small read. */
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
  const day = requested === null ? await latestDay(db) : await dayOnOrBefore(db, requested, today);
  if (day === null) {
    return requested === null
      ? { status: 503, body: { error: "no Treasury data has been loaded yet" } }
      : { status: 404, body: { error: `no Treasury data on or before ${requested}` } };
  }
  return { status: 200, day, years: length as WindowYears };
}

/** The window's rows, pivoted: the one large read (about 2,500 rows a year of window). */
async function windowHistory(db: Database, day: string, years: WindowYears): Promise<HistoryResult> {
  const rows = await yieldsBetween(db, windowStart(day, years), day, PCA_TENORS);
  if (rows.length === 0) return { status: 404, body: { error: `no Treasury data in the ${years}-year window ending ${day}` } };
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
  return { status: 200, body: { day, years, from: days[0], tenors: [...PCA_TENORS], days, yields } };
}

export async function historyPayload(db: Database, requested: string | null, years: string | null, today: string): Promise<HistoryResult> {
  const resolved = await resolveWindow(db, requested, years, today);
  return resolved.status === 200 ? windowHistory(db, resolved.day, resolved.years) : resolved;
}

/** The part of the Workers Cache API used here; absent outside a Worker. */
export interface WindowCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

const ONE_DAY = 86_400;

/**
 * The /history.json response. A resolved window (last stored day and length) is cached for a
 * day: past windows never change, and the latest one moves at most once a day. Errors are not
 * cached.
 */
export async function cachedHistory(
  db: Database,
  requested: string | null,
  years: string | null,
  today: string,
  cache: WindowCache | null,
): Promise<Response> {
  const fail = (status: number, body: { error: string }) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const resolved = await resolveWindow(db, requested, years, today);
  if (resolved.status !== 200) return fail(resolved.status, resolved.body);
  const key = `https://bonds.internal/history/${resolved.day}/${resolved.years}`;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const result = await windowHistory(db, resolved.day, resolved.years);
  if (result.status !== 200) return fail(result.status, result.body);
  const response = Response.json(result.body, { headers: { "cache-control": `public, max-age=${ONE_DAY}` } });
  if (cache) await cache.put(key, response.clone());
  return response;
}
