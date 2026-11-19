import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { curvePayload } from "../lib/curve-data.ts";

// The stored Treasury par yields for a day (?day=YYYY-MM-DD), or the latest day.
export const GET: APIRoute = async ({ url }) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await curvePayload(env.DB, url.searchParams.get("day"), today);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": result.status === 200 ? "public, max-age=600" : "no-store" },
  });
};
