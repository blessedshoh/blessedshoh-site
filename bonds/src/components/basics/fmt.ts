// Number formatting for the model views. Display only: no finance happens here.
export const f = (v: number, digits = 4) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const FREQ_NAME: Record<number, string> = { 1: "annual", 2: "semiannual", 4: "quarterly", 12: "monthly" };
/** Percentage change from a to b, for the show-your-work text. */
export const change = (a: number, b: number) => `${b >= a ? "+" : ""}${f((b / a - 1) * 100, 1)}%`;
