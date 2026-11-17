import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { countVisit, looksAutomated, referrerHost } from "@blessedshoh/kit/hub-data";
import { adminFromRequest } from "./lib/access.ts";

// Links into the CFA site, from before it moved to its own address, land there.
const PREP = "https://prep.blessedshoh.dev";
const CANONICAL_HOST = "blessedshoh.dev";
const FOLDED_HOSTS = new Set(["www.blessedshoh.dev", "next.blessedshoh.dev"]);

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

function refuse(): Response {
  return new Response("Sign-in required. The admin dashboard opens only through Cloudflare Access.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const path = url.pathname;

  // One address for the hub: www and the old test address fold into blessedshoh.dev.
  if (FOLDED_HOSTS.has(url.hostname)) {
    return Response.redirect(`https://${CANONICAL_HOST}${path}${url.search}`, 301);
  }
  const admin = isAdminPath(path);

  if (admin) {
    const email = await adminFromRequest(request, env);
    if (!email) return refuse();
    // Changes must come from the dashboard's own pages, never from another site.
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== url.origin) {
      return new Response("Cross-site request refused.", { status: 403 });
    }
    context.locals.admin = email;
  }

  const response = await next();

  if (response.status === 404 && request.method === "GET" && !admin && !path.startsWith("/api/") && !path.includes(".")) {
    return Response.redirect(`${PREP}${path}${url.search}`, 302);
  }

  const out = new Response(response.body, response);
  if (!import.meta.env.DEV) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  }
  if (admin) out.headers.set("Cache-Control", "no-store");

  const isPage = (out.headers.get("content-type") ?? "").startsWith("text/html");
  if (!admin && request.method === "GET" && out.status === 200 && isPage && !looksAutomated(request.headers.get("user-agent"))) {
    const counting = countVisit(env.DB, path, referrerHost(request.headers.get("referer"), url.hostname)).catch(() => undefined);
    if (context.locals.cfContext) context.locals.cfContext.waitUntil(counting);
    else await counting;
  }
  return out;
});
