import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { listProjects } from "@blessedshoh/kit/hub-data";

// The public project list, for any page that wants to show it. Read-only.
export const GET: APIRoute = async () => {
  const projects = (await listProjects(env.DB)).map(({ slug, title, summary, url, tag, status, featured, in_header, writeup_url }) => ({
    slug,
    title,
    summary,
    url,
    tag,
    status,
    featured: featured === 1,
    in_header: in_header === 1,
    writeup_url,
  }));
  return Response.json(
    { projects },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" } },
  );
};
