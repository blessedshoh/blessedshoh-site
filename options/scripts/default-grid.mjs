// Prices the default example once and stores the answer, so a visitor's first
// view never waits on the pricing server.
//
//   pnpm default-grid                 uses http://127.0.0.1:8000
//   API_BASE=https://... pnpm default-grid
//
// Writes two files:
//   public/default-grid.json          the full grid, loaded right after the page appears
//   src/data/default-first.json       today and expiry only, small enough to ship inside the page

import { readFile, writeFile } from "node:fs/promises";

const base = process.env.API_BASE ?? "http://127.0.0.1:8000";
const here = (path) => new URL(path, import.meta.url);

const settings = JSON.parse(await readFile(here("../src/data/settings.json"), "utf8"));
const position = settings.default_position;

const response = await fetch(`${base}/options/grid`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    spot: position.spot,
    rate: position.rate,
    div_yield: position.div_yield,
    legs: position.legs,
    range_pct: settings.default_range_pct,
  }),
});
if (!response.ok) throw new Error(`The API answered ${response.status}: ${await response.text()}`);

const full = await response.json();
const [, nD, nP] = full.profit.shape;
const unchanged = full.axes.vol_scales.indexOf(1);
if (unchanged < 0) throw new Error("The grid has no volatility multiplier of exactly 1.");

const days = nD > 1 ? [0, nD - 1] : [0];
const row = (day) => full.profit.values.slice((unchanged * nD + day) * nP, (unchanged * nD + day + 1) * nP);
const pick = (table) => [days.map((day) => table[unchanged][day])];

const first = {
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

await writeFile(here("../public/default-grid.json"), JSON.stringify(full));
await writeFile(here("../src/data/default-first.json"), JSON.stringify(first));

const kb = (value) => (JSON.stringify(value).length / 1024).toFixed(0);
console.log(`default-grid.json  ${kb(full)} KB, ${full.profit.values.length} values`);
console.log(`default-first.json ${kb(first)} KB, ${first.profit.values.length} values`);
