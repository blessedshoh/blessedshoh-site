// Compare mode's candidates: right shape for each view, on real strikes, at every price level.
import assert from "node:assert/strict";
import { test } from "node:test";

import { candidates, OUTLOOKS, targetPrice } from "../src/lib/compare.ts";
import { strategyName } from "../src/lib/describe.ts";
import { strikeStep } from "../src/lib/templates.ts";

const NAMED = new Set(["Long call", "Bull call spread", "Short put", "Long put", "Bear put spread", "Bear call spread", "Iron condor", "Long butterfly", "Short strangle", "Long straddle", "Long strangle"]);

test("every outlook gives three candidates on listed strikes, with distinct strikes inside each", () => {
  for (const spot of [8, 42, 166, 1200]) {
    for (const move of [1, 5, 10, 25]) {
      for (const { id } of OUTLOOKS) {
        const list = candidates(id, spot, move, 0.4, 30);
        assert.equal(list.length, 3);
        for (const c of list) {
          const strikes = c.legs.map((leg) => leg.strike);
          for (const k of strikes) {
            assert.ok(k > 0, `${c.name} at ${spot}: strike ${k}`);
            const steps = k / strikeStep(spot);
            assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${c.name} at ${spot}: ${k} is not on the grid`);
          }
          if (c.name.includes("spread") || c.name.includes("condor") || c.name.includes("butterfly") || c.name.includes("strangle")) {
            assert.equal(new Set(strikes).size, strikes.length, `${c.name} at ${spot}, move ${move}: strikes collide`);
          }
        }
      }
    }
  }
});

test("candidates are recognised as the strategies they claim to be", () => {
  for (const { id } of OUTLOOKS) {
    for (const c of candidates(id, 166, 8, 0.4, 30)) {
      if (NAMED.has(c.name)) assert.equal(strategyName({ label: "", spot: 166, rate: 0, div_yield: 0, legs: c.legs }), c.name);
    }
  }
});

test("range strategies are symmetric around the middle strike, so the butterfly is a true butterfly", () => {
  for (const spot of [8, 42, 166, 1200]) {
    for (const move of [1, 3, 8, 25]) {
      const fly = candidates("range", spot, move, 0.4, 30).find((c) => c.name === "Long butterfly");
      const [low, mid, high] = fly.legs.map((leg) => leg.strike);
      assert.ok(Math.abs(mid - low - (high - mid)) < 1e-9, `uneven wings at ${spot}, move ${move}: ${low}/${mid}/${high}`);
      assert.ok(low < mid && mid < high);
    }
  }
});

test("targets follow the view", () => {
  assert.equal(targetPrice("rise", 100, 10), 110.00000000000001);
  assert.equal(targetPrice("fall", 100, 10), 90);
  assert.equal(targetPrice("range", 100, 10), 100);
});
