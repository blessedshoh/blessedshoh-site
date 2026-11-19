// Strategy presets.
import assert from "node:assert/strict";
import { test } from "node:test";

import { snap, strikeStep, TEMPLATES } from "../src/lib/templates.ts";

test("the earnings preset is an at-the-money straddle with an event", () => {
  const preset = TEMPLATES.find((t) => t.id === "straddle-earnings");
  assert.ok(preset, "preset exists");
  assert.equal(preset.name, "Straddle into earnings");
  const legs = preset.build(166, 0.4, 60);
  assert.deepEqual(
    legs.map((leg) => leg.kind),
    ["call", "put"],
  );
  const atm = snap(166, strikeStep(166));
  for (const leg of legs) {
    assert.equal(leg.quantity, 1);
    assert.equal(leg.strike, atm);
    assert.equal(leg.days, 30);
    assert.equal(leg.vol, 0.7);
  }
  assert.deepEqual(preset.event, { days: 5, move: 0.08 });
});

test("other presets carry no event", () => {
  for (const t of TEMPLATES.filter((t) => t.id !== "straddle-earnings")) assert.equal(t.event, undefined, t.id);
});
