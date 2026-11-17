import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// The dashboard's "is the pricing API awake?" check. Only runs when asked,
// because every check wakes the Fly machine.
export const GET: APIRoute = async () => {
  const started = Date.now();
  try {
    const response = await fetch(`${env.API_BASE}/health`, { signal: AbortSignal.timeout(20_000) });
    const ms = Date.now() - started;
    return Response.json({ ok: response.ok, ms, detail: response.ok ? "" : `answered ${response.status}` });
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    return Response.json({ ok: false, ms: Date.now() - started, detail: timedOut ? "no answer in 20 seconds" : "could not connect" });
  }
};
