// The words on screen: strategy names, headlines and number formats.
import assert from "node:assert/strict";
import { test } from "node:test";

import { dateLabel, headline, strategyName } from "../src/lib/describe.ts";
import { axisMoney, niceTicks, signedMoney } from "../src/lib/format.ts";
import { TEMPLATES } from "../src/lib/templates.ts";

const MINUS = "−";
const at166 = (legs) => ({ label: "", spot: 166, rate: 0.04, div_yield: 0, legs });

test("every ready-made strategy is recognised by name, at any price level", () => {
  for (const spot of [8, 42, 166, 1200]) {
    for (const template of TEMPLATES) {
      const position = { label: "", spot, rate: 0, div_yield: 0, legs: template.build(spot, 0.5, 30) };
      // The earnings preset is a long straddle with an announcement attached.
      const expected = template.id === "straddle-earnings" ? "Long straddle" : template.name;
      assert.equal(strategyName(position), expected, `${template.name} at ${spot}`);
    }
  }
});

test("a long call says how far the price has to rise", () => {
  const position = at166([{ kind: "call", quantity: 10, strike: 180, days: 30, vol: 0.64 }]);
  const summary = { breakevens: [187.03], max_profit: null, max_loss: -7030 };
  const payoff = (price) => Math.max(price - 180, 0) * 1000 - 7030;
  assert.equal(
    headline(position, summary, payoff, 124.5, 207.5),
    "The price has to rise 12.7% by expiry for this position to pay off.",
  );
});

test("a short put says how far the price may fall", () => {
  const position = at166([{ kind: "put", quantity: -1, strike: 150, days: 30, vol: 0.7 }]);
  const summary = { breakevens: [146.5], max_profit: 350, max_loss: -14650 };
  const payoff = (price) => 350 - Math.max(150 - price, 0) * 100;
  assert.equal(
    headline(position, summary, payoff, 124.5, 207.5),
    "This position pays off unless the price falls more than 11.7% by expiry.",
  );
});

test("a range-bound position says where the price has to finish", () => {
  const position = at166([]);
  const summary = { breakevens: [147.5, 187.5], max_profit: 250, max_loss: -750 };
  const payoff = (price) => (price > 147.5 && price < 187.5 ? 250 : -750);
  assert.equal(
    headline(position, summary, payoff, 124.5, 207.5),
    "This position pays off if the price finishes between 147.5 and 187.5.",
  );
});

test("date labels count down to expiry", () => {
  assert.equal(dateLabel(0, 30), "Today · 30 days left");
  assert.equal(dateLabel(12, 30), "18 days left");
  assert.equal(dateLabel(29.9, 30), "2 hours left");
  assert.equal(dateLabel(30, 30), "Expiry");
  assert.equal(dateLabel(0, 0), "Today");
});

test("money uses a true minus sign and round axis steps", () => {
  assert.equal(signedMoney(-7030), `${MINUS}$7,030`);
  assert.equal(signedMoney(1240.4), "+$1,240");
  assert.equal(signedMoney(0.4), "$0");
  assert.equal(axisMoney(-2500), `${MINUS}$2.5k`);
  assert.equal(axisMoney(1_250_000), "$1.25M");
  assert.deepEqual(niceTicks(-11000, 32000, 5), [-10000, 0, 10000, 20000, 30000]);
});

// --- earnings (final review fixes) ------------------------------------------------

import { earningsLine, volatilityText } from "../src/lib/describe.ts";
import { readFileSync } from "node:fs";

const legsAt = (before, after, weight = 1) => ({ index: 0, base_vol: after, vol_before: before, vol_after: after, weight });

test("the volatility readout shows everyday volatility when earnings are set", () => {
  assert.equal(volatilityText([0.7], 1.2, null), "84.0%");
  assert.equal(volatilityText([0.7, 0.6], 1.2, null), "×1.20");
  assert.equal(volatilityText([0.7], 1.2, [0.642]), "77.0% everyday");
  assert.equal(volatilityText([0.7, 0.6], 1.2, [0.642, 0.55]), "×1.20 everyday");
});

test("the earnings line says what the announcement does to this position", () => {
  assert.equal(earningsLine(5, 5, [legsAt(0.7, 0.642)]), "Earnings in 5 days: volatility 70.0% → 64.2% after");
  assert.equal(earningsLine(5, null, [legsAt(0.6, 0.55)]), "Earnings after the first expiry: priced only into later legs");
  assert.equal(earningsLine(40, null, []), "Earnings come after every expiry, so they change nothing here");
  assert.equal(earningsLine(null, null, []), "");
  // With several legs, the line follows the one the position depends on most.
  assert.equal(earningsLine(5, 5, [legsAt(0.9, 0.7, 1), legsAt(0.7, 0.642, 9)]), "Earnings in 5 days: volatility 70.0% → 64.2% after");
});

test("the methodology page does not claim today's Greeks are unchanged by earnings", () => {
  const page = readFileSync(new URL("../src/pages/methodology.astro", import.meta.url), "utf8");
  assert.equal(page.includes("today's prices and Greeks do not change"), false);
  assert.ok(page.includes("per point of everyday volatility"));
});
