// Number formatting. One place, so every figure on the page reads the same way.

const MINUS = "−";

export function money(value: number, digits = 0): string {
  return (
    "$" +
    Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  );
}

/** +$1,240, a true minus sign for losses, and plain $0 for nothing. */
export function signedMoney(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return (rounded > 0 ? "+" : MINUS) + money(rounded);
}

export function signedNumber(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return (value > 0 ? "+" : MINUS) + text;
}

export function price(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A price without needless zeros: 180, 182.5 */
export function strike(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function percent(value: number, digits = 1): string {
  return (value * 100).toFixed(digits) + "%";
}

/** Short money for chart axes: $0, $500, $10k, -$2.5k, $1.2M */
export function axisMoney(value: number): string {
  const sign = value < 0 ? MINUS : "";
  const size = Math.abs(value);
  if (size === 0) return "$0";
  if (size >= 1_000_000) return `${sign}$${trim(size / 1_000_000)}M`;
  if (size >= 1_000) return `${sign}$${trim(size / 1_000)}k`;
  return `${sign}$${trim(size)}`;
}

function trim(value: number): string {
  return Number(value.toPrecision(3)).toString();
}

/** Tick values that land on round numbers: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(low: number, high: number, target = 5): number[] {
  const span = high - low;
  if (!(span > 0)) return [low];
  const rough = span / target;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const ratio = rough / power;
  const step = (ratio >= 5 ? 10 : ratio >= 2 ? 5 : ratio >= 1 ? 2 : 1) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(low / step) * step; tick <= high + step * 1e-9; tick += step) {
    ticks.push(Math.abs(tick) < step * 1e-9 ? 0 : Number(tick.toPrecision(12)));
  }
  return ticks;
}
