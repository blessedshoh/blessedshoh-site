import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { countEvent, looksAutomated } from "@blessedshoh/kit/hub-data";
import { EVENTS, type UsageEvent } from "../lib/track.ts";

// Receives the tool's usage events. Same-site requests only, known event names only.
export const POST: APIRoute = async ({ request, url, locals }) => {
  if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403 });
  const event = (await request.text()).trim() as UsageEvent;
  if (!EVENTS.includes(event)) return new Response(null, { status: 400 });
  if (!looksAutomated(request.headers.get("user-agent"))) {
    const counting = countEvent(env.DB, "bonds", event).catch(() => undefined);
    // Lets the write finish after the reply; without it (development), wait for it here.
    if (locals.cfContext) locals.cfContext.waitUntil(counting);
    else await counting;
  }
  return new Response(null, { status: 204 });
};
