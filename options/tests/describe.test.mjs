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
      assert.equal(strategyName(position), template.name, `${template.name} at ${spot}`);
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
