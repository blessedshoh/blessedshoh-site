import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { countVisit, looksAutomated, referrerHost } from "@blessedshoh/kit/hub-data";

// Static files get their headers from public/_headers; rendered pages get them here.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self' https://api.blessedshoh.dev https://blessedshoh-api.fly.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
};

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  const response = await next();
  const out = new Response(response.body, response);
  if (!import.meta.env.DEV) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  }
  const isPage = (out.headers.get("content-type") ?? "").startsWith("text/html");
  if (request.method === "GET" && out.status === 200 && isPage) {
    out.headers.set("Cache-Control", "no-cache");
    if (!looksAutomated(request.headers.get("user-agent"))) {
      const path = `${url.hostname === "localhost" ? "options.blessedshoh.dev" : url.hostname}${url.pathname}`;
      const counting = countVisit(env.DB, path, referrerHost(request.headers.get("referer"), url.hostname)).catch(() => undefined);
      if (locals.cfContext) locals.cfContext.waitUntil(counting);
      else await counting;
    }
  }
  return out;
});
