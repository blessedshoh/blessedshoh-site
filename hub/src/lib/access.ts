// Admin sign-in. Cloudflare Access stands in front of /admin and handles the sign-in
// itself (a one-time code sent to an allowed email address). Every request it lets
// through carries a signed token; this file checks that token again on each request,
// so the dashboard stays closed even if the Access rule were removed by mistake.
//
// Without ACCESS_TEAM_DOMAIN and ACCESS_AUD set, every admin request is refused.
// The one exception is local development: DEV_ADMIN in .dev.vars, on localhost only.

interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ADMIN?: string;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

let certs: { keys: Jwk[]; fetched: number } | null = null;
const CERT_TTL_MS = 10 * 60 * 1000;

function base64url(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodePart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64url(part))) as T;
}

async function signingKeys(team: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && certs && Date.now() - certs.fetched < CERT_TTL_MS) return certs.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certificates answered ${response.status}`);
  const body = (await response.json()) as { keys: Jwk[] };
  certs = { keys: body.keys, fetched: Date.now() };
  return body.keys;
}

const isLocal = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

/** Returns the signed-in admin's email address, or null if the request is not signed in. */
export async function adminFromRequest(request: Request, env: AccessEnv): Promise<string | null> {
  const url = new URL(request.url);
  const team = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const audience = (env.ACCESS_AUD ?? "").trim();

  if (!team || !audience) {
    return env.DEV_ADMIN && isLocal(url) ? env.DEV_ADMIN : null;
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = decodePart<{ alg: string; kid: string }>(parts[0]);
    const claims = decodePart<{ aud: string | string[]; exp: number; nbf?: number; iss: string; email?: string }>(parts[1]);
    if (header.alg !== "RS256") return null;

    let jwk = (await signingKeys(team)).find((key) => key.kid === header.kid);
    // Access rotates its keys; a new key id means the cached list is out of date.
    if (!jwk) jwk = (await signingKeys(team, true)).find((key) => key.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(parts[2]), signed);
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) return null;
    if (claims.iss !== `https://${team}`) return null;
    if (!(claims.exp > now) || (claims.nbf !== undefined && claims.nbf > now + 60)) return null;
    return claims.email ?? null;
  } catch {
    return null;
  }
}
