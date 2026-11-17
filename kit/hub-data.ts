// The hub database (Cloudflare D1, bound as DB), shared by the hub and every tool.
// The admin dashboard writes it; pages read it on each view, so a change shows at once.

/** The part of Cloudflare's D1Database this file uses, so tools need not load the full worker types. */
export interface Database {
  prepare(query: string): Statement;
}
interface Statement {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
type D1Database = Database;

export interface Project {
  id: number;
  slug: string;
  title: string;
  summary: string;
  url: string;
  tag: string;
  status: "live" | "soon" | "hidden";
  featured: number;
  in_header: number;
  sort: number;
  writeup_url: string;
  updated_at: string;
}

export interface HeaderLink {
  title: string;
  url: string;
  current?: boolean;
}

export async function listProjects(db: D1Database, includeHidden = false): Promise<Project[]> {
  const where = includeHidden ? "" : "WHERE status != 'hidden'";
  const { results } = await db.prepare(`SELECT * FROM projects ${where} ORDER BY sort, id`).all<Project>();
  return results;
}

/** The project switcher in every header: live projects marked for the header, in order. */
export async function headerLinks(db: D1Database, currentSlug = ""): Promise<HeaderLink[]> {
  const { results } = await db
    .prepare("SELECT slug, title, url FROM projects WHERE status = 'live' AND in_header = 1 AND url != '' ORDER BY sort, id")
    .all<{ slug: string; title: string; url: string }>();
  return results.map((row) => ({ title: row.title, url: row.url, current: row.slug === currentSlug || undefined }));
}

export async function siteText(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM site_text").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((row) => [row.key, row.value]));
}

export async function toolSettings<T = Record<string, unknown>>(db: D1Database, tool: string): Promise<T | null> {
  const row = await db.prepare("SELECT json FROM tool_settings WHERE tool = ?").bind(tool).first<{ json: string }>();
  return row ? (JSON.parse(row.json) as T) : null;
}

export async function storedFile(db: D1Database, name: string): Promise<string | null> {
  const row = await db.prepare("SELECT json FROM stored_files WHERE name = ?").bind(name).first<{ json: string }>();
  return row?.json ?? null;
}

// --- counters: daily totals only, no cookies and nothing that identifies a visitor ---

export const today = () => new Date().toISOString().slice(0, 10);

/** Automated traffic is left out of the visit numbers. */
export function looksAutomated(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse/i.test(userAgent);
}

/** The referring site's host name, or '' for direct visits and links within the site itself. */
export function referrerHost(referer: string | null, ownHost = ""): string {
  if (!referer) return "";
  try {
    const host = new URL(referer).hostname.toLowerCase();
    const internal = host === ownHost || host === "blessedshoh.dev" || host.endsWith(".blessedshoh.dev");
    return internal ? "" : host.slice(0, 100);
  } catch {
    return "";
  }
}

export function countVisit(db: D1Database, path: string, referrer: string) {
  return db
    .prepare(
      `INSERT INTO daily_visits (day, path, referrer, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (day, path, referrer) DO UPDATE SET count = count + 1`,
    )
    .bind(today(), path.slice(0, 120), referrer)
    .run();
}

export function countEvent(db: D1Database, tool: string, event: string) {
  return db
    .prepare(
      `INSERT INTO daily_events (day, tool, event, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (day, tool, event) DO UPDATE SET count = count + 1`,
    )
    .bind(today(), tool, event)
    .run();
}
