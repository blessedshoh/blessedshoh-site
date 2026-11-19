// Ready-made strategies. Each builds its legs around the current price, so a
// template always produces a sensible position whatever the underlying costs.

import type { EarningsEvent, Leg } from "./types.ts";

/** Strike spacing that looks like a real option chain at this price level. */
export function strikeStep(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 500) return 5;
  return 10;
}

/** Finer spacing used while dragging a strike on the chart. */
export function dragStep(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 500) return 1;
  return 5;
}

export function snap(value: number, step: number): number {
  return Math.max(step, Number((Math.round(value / step) * step).toFixed(4)));
}

export interface Template {
  id: string;
  name: string;
  build: (spot: number, vol: number, days: number) => Leg[];
  /** Set for presets that come with an earnings announcement. */
  event?: EarningsEvent;
}

const at = (spot: number, offset: number) => snap(spot * (1 + offset), strikeStep(spot));
const call = (quantity: number, strike: number, days: number, vol: number): Leg => ({ kind: "call", quantity, strike, days, vol });
const put = (quantity: number, strike: number, days: number, vol: number): Leg => ({ kind: "put", quantity, strike, days, vol });

export const TEMPLATES: Template[] = [
  { id: "long-call", name: "Long call", build: (s, v, d) => [call(1, at(s, 0.08), d, v)] },
  { id: "long-put", name: "Long put", build: (s, v, d) => [put(1, at(s, -0.08), d, v)] },
  { id: "short-put", name: "Short put", build: (s, v, d) => [put(-1, at(s, -0.08), d, v)] },
  { id: "covered-call", name: "Covered call", build: (s, v, d) => [{ kind: "stock", quantity: 100 }, call(-1, at(s, 0.08), d, v)] },
  { id: "bull-call-spread", name: "Bull call spread", build: (s, v, d) => [call(1, at(s, 0.02), d, v), call(-1, at(s, 0.12), d, v)] },
  { id: "bear-put-spread", name: "Bear put spread", build: (s, v, d) => [put(1, at(s, -0.02), d, v), put(-1, at(s, -0.12), d, v)] },
  { id: "long-straddle", name: "Long straddle", build: (s, v, d) => [call(1, at(s, 0), d, v), put(1, at(s, 0), d, v)] },
  { id: "long-strangle", name: "Long strangle", build: (s, v, d) => [call(1, at(s, 0.08), d, v), put(1, at(s, -0.08), d, v)] },
  {
    // Its own volatility and expiry: 70% over 30 days holds a ±8% earnings move with room to spare.
    id: "straddle-earnings",
    name: "Straddle into earnings",
    build: (s) => [call(1, at(s, 0), 30, 0.7), put(1, at(s, 0), 30, 0.7)],
    event: { days: 5, move: 0.08 },
  },
  {
    id: "iron-condor",
    name: "Iron condor",
    build: (s, v, d) => [put(1, at(s, -0.16), d, v), put(-1, at(s, -0.1), d, v), call(-1, at(s, 0.1), d, v), call(1, at(s, 0.16), d, v)],
  },
  {
    id: "butterfly",
    name: "Long butterfly",
    build: (s, v, d) => [call(1, at(s, -0.06), d, v), call(-2, at(s, 0), d, v), call(1, at(s, 0.06), d, v)],
  },
  { id: "calendar", name: "Calendar spread", build: (s, v, d) => [call(-1, at(s, 0.03), d, v), call(1, at(s, 0.03), d * 2, v)] },
];
