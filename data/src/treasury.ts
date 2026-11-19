// The U.S. Treasury's daily par yield curve CSV (one file per year). Columns are read by
// their header because the set of maturities has changed over the years. Values stay in
// percent, exactly as published. Mirrors bondlab.data.treasury on the Python side.

export const TENORS = [
  "1 Mo",
  "1.5 Month",
  "2 Mo",
  "3 Mo",
  "4 Mo",
  "6 Mo",
  "1 Yr",
  "2 Yr",
  "3 Yr",
  "5 Yr",
  "7 Yr",
  "10 Yr",
  "20 Yr",
  "30 Yr",
] as const;

export interface TreasuryDay {
  /** YYYY-MM-DD */
  day: string;
  /** Percent, keyed by CSV header label. Maturities not published that day are absent. */
  yields: Record<string, number>;
}

export interface TreasuryRow {
  day: string;
  tenor: string;
  yieldPct: number;
}

const clean = (cell: string) => cell.trim().replace(/^"|"$/g, "").trim();

function isoDay(text: string, line: number): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const month = match ? Number(match[1]) : 0;
  const day = match ? Number(match[2]) : 0;
  const date = match ? new Date(Date.UTC(Number(match[3]), month - 1, day)) : null;
  if (!match || !date || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`line ${line}: ${JSON.stringify(text)} is not a MM/DD/YYYY date`);
  }
  return `${match[3]}-${match[1]}-${match[2]}`;
}

export function parseTreasuryCsv(text: string): TreasuryDay[] {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map(clean);
  if (header[0] !== "Date") {
    throw new Error(`not a Treasury par-yield CSV: the first column should be "Date"; the text begins ${JSON.stringify(text.trim().slice(0, 40))}`);
  }
  const labels = header.slice(1);
  const unknown = labels.filter((label) => !(TENORS as readonly string[]).includes(label));
  if (unknown.length > 0) throw new Error(`unknown maturities in the header: ${unknown.join(", ")}`);
  const days: TreasuryDay[] = [];
  lines.slice(1).forEach((raw, index) => {
    const line = index + 2;
    if (!raw.trim()) return;
    const cells = raw.split(",").map(clean);
    const yields: Record<string, number> = {};
    labels.forEach((label, i) => {
      const cell = cells[i + 1] ?? "";
      if (cell === "") return;
      const value = Number(cell);
      if (!Number.isFinite(value)) throw new Error(`line ${line}: ${label} value ${JSON.stringify(cell)} is not a number`);
      yields[label] = value;
    });
    days.push({ day: isoDay(cells[0], line), yields });
  });
  return days;
}

/** One row per day and maturity, in the order the maturities appear. */
export function rowsFor(days: TreasuryDay[]): TreasuryRow[] {
  return days.flatMap((d) =>
    TENORS.filter((tenor) => tenor in d.yields).map((tenor) => ({ day: d.day, tenor, yieldPct: d.yields[tenor] })),
  );
}

export function treasuryUrl(year: number): string {
  return (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/" +
    `${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
  );
}
