// Strategies worth comparing for a market view. Each is built around the current
// price and the size of move expected, on the listed strike grid.

import { snap, strikeStep } from "./templates.ts";
import type { Leg } from "./types.ts";

export type Outlook = "rise" | "fall" | "range" | "move";

export interface Candidate {
  name: string;
  /** One sentence on what the strategy trades off. */
  idea: string;
  legs: Leg[];
}

export const OUTLOOKS: { id: Outlook; label: string }[] = [
  { id: "rise", label: "Rise" },
  { id: "fall", label: "Fall" },
  { id: "range", label: "Stay in a range" },
  { id: "move", label: "Big move, either way" },
];

/** Where the view says the price ends up. A range and a big move are centred on today's price. */
export function targetPrice(outlook: Outlook, spot: number, movePct: number): number {
  const move = movePct / 100;
  if (outlook === "rise") return spot * (1 + move);
  if (outlook === "fall") return spot * (1 - move);
  return spot;
}

export function candidates(outlook: Outlook, spot: number, movePct: number, vol: number, days: number): Candidate[] {
  const step = strikeStep(spot);
  const move = Math.max(movePct, 1) / 100;
  const at = (offset: number) => snap(spot * (1 + offset), step);
  const atm = at(0);
  // A strike at least one step away from another, in the given direction.
  const beyond = (strike: number, offset: number, direction: 1 | -1) => {
    const k = at(offset);
    return direction > 0 ? Math.max(k, strike + step) : Math.max(step, Math.min(k, strike - step));
  };
  const call = (quantity: number, strike: number): Leg => ({ kind: "call", quantity, strike, days, vol });
  const put = (quantity: number, strike: number): Leg => ({ kind: "put", quantity, strike, days, vol });

  switch (outlook) {
    case "rise": {
      const high = beyond(atm, move, 1);
      const low = beyond(atm, -move / 2, -1);
      return [
        { name: "Long call", idea: "Unlimited upside; you pay the most time value.", legs: [call(1, atm)] },
        { name: "Bull call spread", idea: "Cheaper than a call, but gains stop at the upper strike.", legs: [call(1, atm), call(-1, high)] },
        { name: "Short put", idea: "Paid up front and wins if the price merely holds; big losses if it falls.", legs: [put(-1, low)] },
      ];
    }
    case "fall": {
      const low = beyond(atm, -move, -1);
      const high = beyond(atm, move / 2, 1);
      return [
        { name: "Long put", idea: "Gains all the way down to zero; costs the most.", legs: [put(1, atm)] },
        { name: "Bear put spread", idea: "Cheaper, with gains capped at the lower strike.", legs: [put(1, atm), put(-1, low)] },
        { name: "Bear call spread", idea: "Paid up front and wins if the price doesn't rise; loss capped.", legs: [call(-1, high), call(1, beyond(high, move, 1))] },
      ];
    }
    case "range": {
      // Strikes the same distance either side of the middle one: rounding each side
      // separately can leave uneven wings, which turns a butterfly into a different trade.
      const half = Math.max(step, snap(spot * move, step));
      const lowInner = Math.max(step, atm - half);
      const highInner = atm + (atm - lowInner);
      return [
        {
          name: "Iron condor",
          idea: "Paid to wait between the short strikes; losses capped by the wings.",
          legs: [put(1, beyond(lowInner, -move * 1.6, -1)), put(-1, lowInner), call(-1, highInner), call(1, beyond(highInner, move * 1.6, 1))],
        },
        {
          name: "Long butterfly",
          idea: "Cheap, and pays most if the price finishes right at the middle strike.",
          legs: [call(1, lowInner), call(-2, atm), call(1, highInner)],
        },
        { name: "Short strangle", idea: "Collects the most premium, with no limit on losses either way.", legs: [put(-1, lowInner), call(-1, highInner)] },
      ];
    }
    default: {
      const highNear = beyond(atm, move / 2, 1);
      const lowNear = beyond(atm, -move / 2, -1);
      return [
        { name: "Long straddle", idea: "Wins on a move in either direction; the most expensive.", legs: [call(1, atm), put(1, atm)] },
        { name: "Long strangle", idea: "Cheaper than a straddle, but needs a bigger move.", legs: [call(1, highNear), put(1, lowNear)] },
        {
          name: "Wide strangle",
          idea: "Cheapest of the three; only a large move pays.",
          legs: [call(1, beyond(highNear, move, 1)), put(1, beyond(lowNear, -move, -1))],
        },
      ];
    }
  }
}
