// Turning a position and its numbers into words: the strategy's name, the
// headline that states what has to happen for it to pay off, and date labels.

import { money, strike as formatStrike } from "./format.ts";
import type { EventLeg, Leg, Position, Summary } from "./types.ts";

const isOption = (leg: Leg) => leg.kind !== "stock";
const side = (quantity: number) => (quantity > 0 ? "Long" : "Short");
const byStrike = (a: Leg, b: Leg) => a.strike! - b.strike! || (a.kind === "put" ? -1 : 1);

export function strategyName(position: Position): string {
  const legs = position.legs;
  const options = legs.filter(isOption);
  const stock = legs.filter((leg) => !isOption(leg));
  const sameExpiry = options.every((leg) => leg.days === options[0].days);

  if (legs.length === 1) return `${side(legs[0].quantity)} ${legs[0].kind}`;

  if (legs.length === 2 && stock.length === 1 && options.length === 1 && stock[0].quantity > 0) {
    if (options[0].kind === "call" && options[0].quantity < 0) return "Covered call";
    if (options[0].kind === "put" && options[0].quantity > 0) return "Protective put";
  }

  if (legs.length === 2 && options.length === 2) {
    const [low, high] = [...options].sort(byStrike);
    const equalSize = Math.abs(low.quantity) === Math.abs(high.quantity);
    const opposite = low.quantity * high.quantity < 0;
    if (low.kind === high.kind && equalSize && opposite) {
      if (!sameExpiry && low.strike === high.strike) return "Calendar spread";
      if (sameExpiry && low.strike !== high.strike) {
        const longLower = low.quantity > 0;
        if (low.kind === "call") return longLower ? "Bull call spread" : "Bear call spread";
        return longLower ? "Bull put spread" : "Bear put spread";
      }
    }
    if (low.kind !== high.kind && equalSize && !opposite && sameExpiry) {
      return `${side(low.quantity)} ${low.strike === high.strike ? "straddle" : "strangle"}`;
    }
  }

  if (legs.length === 3 && options.length === 3 && sameExpiry && options.every((leg) => leg.kind === options[0].kind)) {
    const [a, b, c] = [...options].sort(byStrike);
    if (a.quantity === c.quantity && b.quantity === -2 * a.quantity) {
      return a.quantity > 0 ? "Long butterfly" : "Short butterfly";
    }
  }

  if (legs.length === 4 && options.length === 4 && sameExpiry) {
    const [a, b, c, d] = [...options].sort(byStrike);
    const shape = a.kind === "put" && b.kind === "put" && c.kind === "call" && d.kind === "call";
    if (shape && a.quantity > 0 && b.quantity < 0 && c.quantity < 0 && d.quantity > 0) {
      return b.strike === c.strike ? "Iron butterfly" : "Iron condor";
    }
  }

  return "Custom position";
}

export function daysText(days: number): string {
  if (days >= 1) {
    const whole = Math.round(days);
    return `${whole} ${whole === 1 ? "day" : "days"}`;
  }
  const hours = Math.max(1, Math.round(days * 24));
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** Label for the selected date on the slider and on the chart. */
export function dateLabel(elapsed: number, total: number): string {
  if (total <= 0) return "Today";
  const left = total - elapsed;
  if (left <= total * 1e-6) return "Expiry";
  if (elapsed <= total * 1e-6) return `Today · ${daysText(total)} left`;
  return `${daysText(left)} left`;
}

export function kicker(position: Position, summary: Summary, label = position.label): string {
  const parts = [strategyName(position)];
  if (label.trim()) parts.push(label.trim());
  if (summary.first_expiry_days != null) {
    parts.push(summary.first_expiry_days > 0 ? `${daysText(summary.first_expiry_days)} to expiry` : "Expires today");
  }
  return parts.join(" · ");
}

/**
 * One sentence saying what has to happen by expiry for the position to make money.
 * `expiryProfit` reads the expiry payoff at a price; `lowPrice` and `highPrice`
 * are the ends of the price range it covers.
 */
export function headline(
  position: Position,
  summary: Summary,
  expiryProfit: (price: number) => number,
  lowPrice: number,
  highPrice: number,
): string {
  const spot = position.spot;
  const points = summary.breakevens;
  const move = (target: number) => `${(Math.abs(target / spot - 1) * 100).toFixed(1)}%`;

  if (points.length === 1) {
    const point = points[0];
    // Look at a price we can read on one side of the break-even to learn which side makes money.
    const profitableAbove = highPrice > point ? expiryProfit(highPrice) > 0 : expiryProfit(lowPrice) < 0;
    if (profitableAbove) {
      return point > spot
        ? `The price has to rise ${move(point)} by expiry for this position to pay off.`
        : `This position pays off unless the price falls more than ${move(point)} by expiry.`;
    }
    return point < spot
      ? `The price has to fall ${move(point)} by expiry for this position to pay off.`
      : `This position pays off unless the price rises more than ${move(point)} by expiry.`;
  }

  if (points.length === 2) {
    const [low, high] = points;
    const between = `${formatStrike(Number(low.toFixed(2)))} and ${formatStrike(Number(high.toFixed(2)))}`;
    return expiryProfit((low + high) / 2) > 0
      ? `This position pays off if the price finishes between ${between}.`
      : `The price has to finish outside ${between} for this position to pay off.`;
  }

  if (points.length > 2) {
    return `This position breaks even at ${points.length} prices, so read the chart, not a single number.`;
  }

  if (summary.max_loss != null && summary.max_loss >= 0) return "At expiry this position cannot lose.";
  if (summary.max_profit != null && summary.max_profit <= 0) return "At expiry this position cannot make money.";
  return "Profit and loss by price.";
}

/** The sentence under the headline: what one more day costs or earns. */
export function decaySentence(thetaPerDay: number, daysLeft: number, hasOptions: boolean): string {
  if (!hasOptions) return "There are no options in this position, so time and volatility do not change its value.";
  if (daysLeft <= 0.02) return "At expiry the outcome depends on the price alone.";
  if (Math.abs(thetaPerDay) < 0.5) return `With ${daysText(daysLeft)} left, time passing barely changes its value.`;
  return thetaPerDay < 0
    ? `With ${daysText(daysLeft)} left, it loses about ${money(-thetaPerDay)} a day if the price stands still.`
    : `With ${daysText(daysLeft)} left, it earns about ${money(thetaPerDay)} a day if the price stands still.`;
}

/**
 * The volatility slider's readout. With earnings set, the slider moves everyday
 * volatility only, so that is what it shows.
 */
export function volatilityText(legVols: number[], volScale: number, everyday: number[] | null): string {
  const unique = [...new Set(everyday ?? legVols)];
  const text = unique.length === 1 ? `${(unique[0] * volScale * 100).toFixed(1)}%` : `×${volScale.toFixed(2)}`;
  return everyday ? `${text} everyday` : text;
}

/**
 * One line on what the earnings announcement does to this position.
 * eventDays: the announcement's day, or null for none. eventDay: the same, but only
 * when it falls inside the chart's dates. legs: the legs still alive at it.
 */
export function earningsLine(eventDays: number | null, eventDay: number | null, legs: EventLeg[]): string {
  if (eventDays === null) return "";
  if (legs.length === 0) return "Earnings come after every expiry, so they change nothing here";
  if (eventDay === null) return "Earnings after the first expiry: priced only into later legs";
  const main = legs.reduce((best, leg) => (leg.weight > best.weight ? leg : best));
  return `Earnings in ${daysText(eventDay)}: volatility ${(main.vol_before * 100).toFixed(1)}% → ${(main.vol_after * 100).toFixed(1)}% after`;
}
