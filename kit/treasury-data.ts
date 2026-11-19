// Reads of the stored Treasury par yields (table treasury_par_yields in the hub database).
// Pages use these and never call treasury.gov themselves.

import type { Database } from "./hub-data.ts";

export const FIRST_DAY = "1990-01-02";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function latestDay(db: Database): Promise<string | null> {
  const row = await db.prepare("SELECT MAX(day) AS day FROM treasury_par_yields").first<{ day: string | null }>();
  return row?.day ?? null;
}

/**
 * The last stored day on or before `day`: a weekend or holiday reads the business day
 * before it. Null for a malformed date, a date before 1990 or a date after `today`.
 */
export async function dayOnOrBefore(db: Database, day: string, today: string): Promise<string | null> {
  if (!ISO_DAY.test(day) || day < FIRST_DAY || day > today) return null;
  const row = await db
    .prepare("SELECT MAX(day) AS day FROM treasury_par_yields WHERE day <= ?")
    .bind(day)
    .first<{ day: string | null }>();
  return row?.day ?? null;
}

/** Yields in percent, keyed by maturity label, for one stored day. */
export async function yieldsFor(db: Database, day: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT tenor, yield_pct FROM treasury_par_yields WHERE day = ?")
    .bind(day)
    .all<{ tenor: string; yield_pct: number }>();
  return Object.fromEntries(results.map((row) => [row.tenor, row.yield_pct]));
}
