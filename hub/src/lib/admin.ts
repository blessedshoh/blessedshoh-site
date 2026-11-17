// Writes made from the admin dashboard. Each one is recorded in the change log
// in the same database batch, so the log can never miss an edit.

import { toolSettings } from "@blessedshoh/kit/hub-data";
import { Invalid, type ExampleInput, type ProjectInput } from "./validate.ts";

const logStatement = (db: D1Database, who: string, area: string, summary: string) =>
  db.prepare("INSERT INTO changes (who, area, summary) VALUES (?, ?, ?)").bind(who, area, summary.slice(0, 300));

export async function recentChanges(db: D1Database, limit = 12) {
  const { results } = await db
    .prepare("SELECT at, who, area, summary FROM changes ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<{ at: string; who: string; area: string; summary: string }>();
  return results;
}

// --- projects -----------------------------------------------------------------

export async function saveProject(db: D1Database, who: string, id: number | null, p: ProjectInput) {
  const clash = await db.prepare("SELECT id FROM projects WHERE slug = ? AND id != ?").bind(p.slug, id ?? -1).first();
  if (clash) throw new Invalid(`Another project already uses the short name "${p.slug}".`);
  const values = [p.slug, p.title, p.summary, p.url, p.tag, p.status, p.featured, p.in_header, p.writeup_url];
  if (id === null) {
    const next = await db.prepare("SELECT COALESCE(MAX(sort), 0) + 10 AS sort FROM projects").first<{ sort: number }>();
    await db.batch([
      db
        .prepare(
          `INSERT INTO projects (slug, title, summary, url, tag, status, featured, in_header, writeup_url, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...values, next?.sort ?? 10),
      logStatement(db, who, "projects", `Added "${p.title}"`),
    ]);
  } else {
    await db.batch([
      db
        .prepare(
          `UPDATE projects SET slug = ?, title = ?, summary = ?, url = ?, tag = ?, status = ?, featured = ?,
           in_header = ?, writeup_url = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .bind(...values, id),
      logStatement(db, who, "projects", `Edited "${p.title}"`),
    ]);
  }
}

export async function deleteProject(db: D1Database, who: string, id: number) {
  const row = await db.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first<{ title: string }>();
  if (!row) return;
  await db.batch([
    db.prepare("DELETE FROM projects WHERE id = ?").bind(id),
    logStatement(db, who, "projects", `Deleted "${row.title}"`),
  ]);
}

/** Swaps a project with its neighbour above or below, then renumbers so the order stays clean. */
export async function moveProject(db: D1Database, who: string, id: number, direction: "up" | "down") {
  const { results } = await db.prepare("SELECT id, title FROM projects ORDER BY sort, id").all<{ id: number; title: string }>();
  const at = results.findIndex((row) => row.id === id);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= results.length) return;
  [results[at], results[to]] = [results[to], results[at]];
  await db.batch([
    ...results.map((row, index) => db.prepare("UPDATE projects SET sort = ? WHERE id = ?").bind((index + 1) * 10, row.id)),
    logStatement(db, who, "projects", `Moved "${results[to].title}" ${direction}`),
  ]);
}

// --- site text ----------------------------------------------------------------

export async function saveText(db: D1Database, who: string, values: Record<string, string>) {
  const current = Object.fromEntries(
    (await db.prepare("SELECT key, value FROM site_text").all<{ key: string; value: string }>()).results.map((r) => [r.key, r.value]),
  );
  const changed = Object.keys(values).filter((key) => (current[key] ?? "") !== values[key]);
  if (changed.length === 0) return 0;
  await db.batch([
    ...changed.map((key) =>
      db
        .prepare(
          `INSERT INTO site_text (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
        .bind(key, values[key]),
    ),
    logStatement(db, who, "site text", `Changed ${changed.join(", ")}`),
  ]);
  return changed.length;
}

// --- tool settings --------------------------------------------------------------

export interface OptionsHubSettings {
  flags: Record<string, boolean>;
  banner: string | null;
  /** The admin's default example and its stored first view. null means the tool's built-in one. */
  example: (ExampleInput & { first: unknown; firstRisk: unknown; saved_at: string }) | null;
}

export const OPTIONS_GRID_FILE = "options/default-grid";

export async function optionsSettings(db: D1Database): Promise<OptionsHubSettings> {
  const stored = await toolSettings<OptionsHubSettings>(db, "options");
  return { flags: stored?.flags ?? {}, banner: stored?.banner ?? null, example: stored?.example ?? null };
}

function writeSettings(db: D1Database, value: OptionsHubSettings) {
  return db
    .prepare(
      `INSERT INTO tool_settings (tool, json) VALUES ('options', ?)
       ON CONFLICT (tool) DO UPDATE SET json = excluded.json, updated_at = datetime('now')`,
    )
    .bind(JSON.stringify(value));
}

export async function saveOptionsSwitches(db: D1Database, who: string, flags: Record<string, boolean>, banner: string | null) {
  const current = await optionsSettings(db);
  const on = Object.keys(flags).filter((key) => flags[key]);
  await db.batch([
    writeSettings(db, { ...current, flags, banner }),
    logStatement(db, who, "options tool", `Switches on: ${on.join(", ") || "none"}; notice ${banner ? "shown" : "off"}`),
  ]);
}

/**
 * Prices the new default example on the Python API once and stores the answers,
 * so a visitor's first view is instant even while the API is asleep.
 */
export async function saveOptionsExample(db: D1Database, who: string, apiBase: string, example: ExampleInput | null) {
  const current = await optionsSettings(db);
  if (example === null) {
    await db.batch([
      writeSettings(db, { ...current, example: null }),
      db.prepare("DELETE FROM stored_files WHERE name = ?").bind(OPTIONS_GRID_FILE),
      logStatement(db, who, "options tool", "Default example reset to the built-in one"),
    ]);
    return;
  }

  const { position, range_pct, risk_defaults } = example;
  const body = {
    spot: position.spot,
    rate: position.rate,
    div_yield: position.div_yield,
    legs: position.legs,
    exercise: position.exercise,
    range_pct,
  };
  const post = async (path: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`The pricing API refused the example (${response.status}): ${detail.slice(0, 300)}`);
    }
    return response.json();
  };

  // The grid first: it also wakes the API if it was asleep.
  const full = (await post("/options/grid")) as GridLike;
  const [risk, explain] = await Promise.all([
    post("/options/risk"),
    post("/options/explain", {
      price_move_pct: risk_defaults.move_pct,
      days_passed: risk_defaults.days,
      vol_shift: risk_defaults.vol_points / 100,
    }),
  ]);

  const first = firstView(full);
  const saved: OptionsHubSettings["example"] = { ...example, first, firstRisk: { risk, explain }, saved_at: new Date().toISOString() };
  const legs = position.legs.length === 1 ? "1 leg" : `${position.legs.length} legs`;
  await db.batch([
    writeSettings(db, { ...current, example: saved }),
    db
      .prepare(
        `INSERT INTO stored_files (name, json) VALUES (?, ?)
         ON CONFLICT (name) DO UPDATE SET json = excluded.json, updated_at = datetime('now')`,
      )
      .bind(OPTIONS_GRID_FILE, JSON.stringify(full)),
    logStatement(db, who, "options tool", `Default example set: ${position.label || "untitled"}, ${legs}, price ${position.spot}`),
  ]);
}

interface GridLike {
  axes: { prices: number[]; days: number[]; vol_scales: number[] };
  profit: { shape: [number, number, number]; values: number[] };
  greeks: Record<"delta" | "gamma" | "theta_per_day" | "vega_per_point", number[][][]>;
  summary: unknown;
}

/** Today and expiry only, at unchanged volatility: small enough to ship inside the page. */
function firstView(full: GridLike) {
  const [, nD, nP] = full.profit.shape;
  const unchanged = full.axes.vol_scales.indexOf(1);
  if (unchanged < 0) throw new Error("The grid has no volatility multiplier of exactly 1.");
  const days = nD > 1 ? [0, nD - 1] : [0];
  const row = (day: number) => full.profit.values.slice((unchanged * nD + day) * nP, (unchanged * nD + day + 1) * nP);
  const pick = (table: number[][][]) => [days.map((day) => table[unchanged][day])];
  return {
    axes: { prices: full.axes.prices, days: days.map((day) => full.axes.days[day]), vol_scales: [1] },
    profit: { shape: [1, days.length, nP], values: days.flatMap(row) },
    greeks: {
      delta: pick(full.greeks.delta),
      gamma: pick(full.greeks.gamma),
      theta_per_day: pick(full.greeks.theta_per_day),
      vega_per_point: pick(full.greeks.vega_per_point),
    },
    summary: full.summary,
  };
}

// --- numbers ------------------------------------------------------------------

export async function numbers(db: D1Database, days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [daily, pages, referrers, events] = await db.batch([
    db.prepare("SELECT day, SUM(count) AS n FROM daily_visits WHERE day >= ? GROUP BY day ORDER BY day").bind(since),
    db.prepare("SELECT path, SUM(count) AS n FROM daily_visits WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 10").bind(since),
    db
      .prepare("SELECT referrer, SUM(count) AS n FROM daily_visits WHERE day >= ? AND referrer != '' GROUP BY referrer ORDER BY n DESC LIMIT 10")
      .bind(since),
    db.prepare("SELECT tool, event, SUM(count) AS n FROM daily_events WHERE day >= ? GROUP BY tool, event ORDER BY tool, n DESC").bind(since),
  ]);
  const byDay = new Map((daily.results as { day: string; n: number }[]).map((row) => [row.day, row.n]));
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, n: byDay.get(day) ?? 0 };
  });
  return {
    since,
    series,
    pages: pages.results as { path: string; n: number }[],
    referrers: referrers.results as { referrer: string; n: number }[],
    events: events.results as { tool: string; event: string; n: number }[],
  };
}
