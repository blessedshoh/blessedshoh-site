// The stored Treasury curve for one day, as the page and /curve.json serve it.
// Reads the hub database only; never treasury.gov.

import type { Database } from "@blessedshoh/kit/hub-data";
import { FIRST_DAY, dayOnOrBefore, latestDay, yieldsFor } from "@blessedshoh/kit/treasury-data";
import { isIsoDay } from "./state.ts";

export interface StoredCurve {
  /** The day the data is for: the nearest earlier business day when the requested one has none. */
  day: string;
  /** What was asked for, or null for "latest". */
  requested: string | null;
  /** Percent, by maturity label. */
  yields: Record<string, number>;
}

export type CurveResult = { status: 200; body: StoredCurve } | { status: 400 | 404 | 503; body: { error: string } };

export async function curvePayload(db: Database, requested: string | null, today: string): Promise<CurveResult> {
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
  return { status: 200, body: { day, requested, yields: await yieldsFor(db, day) } };
}
