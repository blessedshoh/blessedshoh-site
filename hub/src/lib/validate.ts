// Every value the dashboard accepts is checked here before it reaches the database.
// Pages print these values as plain text, so nothing typed in the admin can run as code.

export class Invalid extends Error {}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

function limited(value: string, label: string, max: number, required = false): string {
  if (required && !value) throw new Invalid(`${label} is required.`);
  if (value.length > max) throw new Invalid(`${label} must be ${max} characters or fewer.`);
  return value;
}

export function webAddress(value: string, label: string): string {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Invalid(`${label} must be a full address starting with https://.`);
  }
  if (url.protocol !== "https:") throw new Invalid(`${label} must start with https://.`);
  return limited(url.toString().replace(/\/$/, url.pathname === "/" ? "" : "/"), label, 300);
}

function number(value: string, label: string, low: number, high: number): number {
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) throw new Invalid(`${label} must be a number.`);
  if (n < low || n > high) throw new Invalid(`${label} must be between ${low} and ${high}.`);
  return n;
}

// --- projects -----------------------------------------------------------------

export const STATUSES = ["live", "soon", "hidden"] as const;

export interface ProjectInput {
  slug: string;
  title: string;
  summary: string;
  url: string;
  tag: string;
  status: (typeof STATUSES)[number];
  featured: number;
  in_header: number;
  writeup_url: string;
}

export function projectFromForm(form: FormData): ProjectInput {
  const slug = text(form, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    throw new Invalid("Short name must be lowercase letters, digits and dashes, up to 40 characters.");
  }
  const status = text(form, "status") as ProjectInput["status"];
  if (!STATUSES.includes(status)) throw new Invalid("Choose a status.");
  return {
    slug,
    title: limited(text(form, "title"), "Title", 80, true),
    summary: limited(text(form, "summary"), "Summary", 400),
    url: webAddress(text(form, "url"), "Address"),
    tag: limited(text(form, "tag"), "Tag", 30),
    status,
    featured: form.get("featured") ? 1 : 0,
    in_header: form.get("in_header") ? 1 : 0,
    writeup_url: webAddress(text(form, "writeup_url"), "Write-up address"),
  };
}

// --- site text ----------------------------------------------------------------

export const TEXT_FIELDS = [
  { key: "headline", label: "Headline", max: 120, rows: 2, help: "The large line at the top of the home page." },
  { key: "intro", label: "Intro", max: 400, rows: 3, help: "The paragraph under the headline." },
  { key: "about", label: "About", max: 2000, rows: 7, help: "A blank line starts a new paragraph." },
  {
    key: "facts",
    label: "Facts",
    max: 400,
    rows: 4,
    help: "Up to four lines, each written as  value | label,  for example  1,898 | tests passing.",
  },
  { key: "github_url", label: "GitHub", max: 300, rows: 1, help: "Full address, or empty to hide." },
  { key: "linkedin_url", label: "LinkedIn", max: 300, rows: 1, help: "Full address, or empty to hide." },
  { key: "email", label: "Public email", max: 120, rows: 1, help: "Shown on the page. Leave empty to hide." },
] as const;

export function textFromForm(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of TEXT_FIELDS) {
    let value = limited(text(form, field.key).replace(/\r\n/g, "\n"), field.label, field.max);
    if (field.key.endsWith("_url")) value = webAddress(value, field.label);
    if (field.key === "email" && value && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(value)) {
      throw new Invalid("Public email does not look like an email address.");
    }
    if (field.key === "facts") {
      const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length > 4) throw new Invalid("Facts can have up to four lines.");
      if (lines.some((line) => line.split("|").length !== 2)) throw new Invalid("Write each fact as  value | label.");
      value = lines.join("\n");
    }
    out[field.key] = value;
  }
  return out;
}

/** "value | label" lines from the Facts field. */
export function parseFacts(value: string | undefined): { value: string; label: string }[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
    .map(([value, label]) => ({ value, label }));
}

// --- options tool settings ------------------------------------------------------

export const OPTION_FLAGS = [
  { key: "risk", label: "Risk view", help: "Scenario grid, P/L explain and chance of profit." },
  { key: "binomial", label: "Binomial trees", help: "American exercise, tree explorer and convergence chart." },
  { key: "chain", label: "Chain and arbitrage", help: "Volatility smile chain and the arbitrage checker." },
  { key: "sketch", label: "Payoff sketcher", help: "Draw a payoff and get the portfolio that builds it." },
  { key: "compare", label: "Compare", help: "Strategies side by side for a market outlook." },
] as const;

export interface Leg {
  kind: "call" | "put" | "stock";
  quantity: number;
  strike?: number;
  days?: number;
  vol?: number;
}

export interface ExampleInput {
  position: { label: string; spot: number; rate: number; div_yield: number; legs: Leg[]; exercise: "european" | "american" };
  range_pct: number;
  risk_defaults: { move_pct: number; days: number; vol_points: number };
}

export const MAX_LEGS = 6;

export function flagsFromForm(form: FormData): Record<string, boolean> {
  return Object.fromEntries(OPTION_FLAGS.map((flag) => [flag.key, form.get(`flag_${flag.key}`) !== null]));
}

export function bannerFromForm(form: FormData): string | null {
  return limited(text(form, "banner"), "Notice", 200) || null;
}

export function exampleFromForm(form: FormData): ExampleInput {
  const legs: Leg[] = [];
  for (let i = 0; i < MAX_LEGS; i++) {
    const kind = text(form, `leg${i}_kind`);
    const qty = text(form, `leg${i}_quantity`);
    if (!kind || !qty) continue;
    if (kind !== "call" && kind !== "put" && kind !== "stock") throw new Invalid(`Leg ${i + 1}: choose call, put or stock.`);
    const quantity = number(qty, `Leg ${i + 1} quantity`, -10_000, 10_000);
    if (quantity === 0) throw new Invalid(`Leg ${i + 1}: quantity cannot be zero.`);
    if (kind === "stock") {
      legs.push({ kind, quantity });
      continue;
    }
    legs.push({
      kind,
      quantity,
      strike: number(text(form, `leg${i}_strike`), `Leg ${i + 1} strike`, 0.01, 1_000_000),
      days: Math.round(number(text(form, `leg${i}_days`), `Leg ${i + 1} days`, 1, 1825)),
      vol: number(text(form, `leg${i}_vol`), `Leg ${i + 1} volatility`, 1, 500) / 100,
    });
  }
  if (legs.length === 0) throw new Invalid("Add at least one leg.");
  const exercise = text(form, "exercise") === "american" ? "american" : "european";
  return {
    position: {
      label: limited(text(form, "label"), "Label", 12),
      spot: number(text(form, "spot"), "Price", 0.01, 1_000_000),
      rate: number(text(form, "rate"), "Interest rate", -5, 50) / 100,
      div_yield: number(text(form, "div_yield"), "Dividend yield", 0, 50) / 100,
      legs,
      exercise,
    },
    range_pct: number(text(form, "range_pct"), "Price range", 2, 90) / 100,
    risk_defaults: {
      move_pct: number(text(form, "move_pct"), "Risk move", -90, 90) / 100,
      days: Math.round(number(text(form, "risk_days"), "Risk days", 0, 1825)),
      vol_points: number(text(form, "vol_points"), "Volatility change", -100, 100),
    },
  };
}
