import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { storedFile } from "@blessedshoh/kit/hub-data";

// The full grid for the admin's default example, stored by the hub when it was saved.
// The built-in example's grid is the static file /builtin-grid.json.
export const GET: APIRoute = async () => {
  const json = await storedFile(env.DB, "options/default-grid");
  if (!json) return new Response("No stored example.", { status: 404 });
  return new Response(json, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
};
