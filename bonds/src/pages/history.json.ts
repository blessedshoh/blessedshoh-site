import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { cachedHistory, type WindowCache } from "../lib/history-data.ts";

// The stored par yields for a PCA window (?day=YYYY-MM-DD&years=1|2|5|10). A ten-year window
// is about 25,000 rows of D1 reads, so each resolved window is cached in the Worker's colo.
export const GET: APIRoute = async ({ url }) => {
  const today = new Date().toISOString().slice(0, 10);
  const cache = typeof caches === "undefined" ? null : ((caches as unknown as { default: WindowCache }).default ?? null);
  return cachedHistory(env.DB, url.searchParams.get("day"), url.searchParams.get("years"), today, cache);
};
