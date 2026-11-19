// One-off: download every yearly Treasury par-yield file from 1990 and write SQL that
// loads them into treasury_par_yields. Then apply it with wrangler:
//
//   pnpm --dir data run backfill
//   pnpm --dir hub exec wrangler d1 execute blessedshoh-hub --local  --file ../data/.backfill/backfill.sql
//   pnpm --dir hub exec wrangler d1 execute blessedshoh-hub --remote --file ../data/.backfill/backfill.sql
//
// Re-running is safe: rows are upserted.

import { mkdir, writeFile } from "node:fs/promises";

import { parseTreasuryCsv, rowsFor, treasuryUrl } from "../src/treasury.ts";

const first = 1990;
const last = new Date().getUTCFullYear();
const out = new URL("../.backfill/", import.meta.url);
await mkdir(out, { recursive: true });

const lines = [];
let total = 0;
for (let year = first; year <= last; year++) {
  const response = await fetch(treasuryUrl(year), { headers: { accept: "text/csv", "user-agent": "blessedshoh-data/1.0" } });
  if (!response.ok) throw new Error(`${year}: treasury.gov answered ${response.status}`);
  const days = parseTreasuryCsv(await response.text());
  const rows = rowsFor(days);
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows
      .slice(i, i + 200)
      .map((r) => `('${r.day}', '${r.tenor}', ${r.yieldPct})`)
      .join(",\n");
    lines.push(
      `INSERT INTO treasury_par_yields (day, tenor, yield_pct) VALUES\n${values}\nON CONFLICT (day, tenor) DO UPDATE SET yield_pct = excluded.yield_pct;`,
    );
  }
  total += rows.length;
  console.log(`${year}: ${days.length} days, ${rows.length} rows`);
}
await writeFile(new URL("backfill.sql", out), lines.join("\n") + "\n");
console.log(`wrote ${total} rows to data/.backfill/backfill.sql`);
