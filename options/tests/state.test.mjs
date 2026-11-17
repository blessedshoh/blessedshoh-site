// Shareable links: what goes in must come out, and nothing out of bounds gets through.
import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeState, encodeState } from "../src/lib/state.ts";

const position = {
  label: "XYZ",
  spot: 166,
  rate: 0.04,
  div_yield: 0,
  legs: [
    { kind: "call", quantity: 10, strike: 180, days: 30, vol: 0.64 },
    { kind: "put", quantity: -2, strike: 150, days: 30, vol: 0.7 },
    { kind: "stock", quantity: -100 },
  ],
};

test("a position survives the trip through a link", () => {
  assert.deepEqual(decodeState(encodeState(position, 0.3)), { position, rangePct: 0.3 });
});

test("labels in any script survive", () => {
  const named = { ...position, label: "Ñ€£ 株" };
  assert.equal(decodeState(encodeState(named, 0.25)).position.label, "Ñ€£ 株");
});

test("links that break the limits are refused", () => {
  const tooVolatile = { ...position, legs: [{ ...position.legs[0], vol: 50 }] };
  const tooMany = { ...position, legs: Array(9).fill(position.legs[0]) };
  const negativeSpot = { ...position, spot: -1 };
  const zeroQuantity = { ...position, legs: [{ ...position.legs[0], quantity: 0 }] };
  for (const bad of [tooVolatile, tooMany, negativeSpot, zeroQuantity]) {
    assert.equal(decodeState(encodeState(bad, 0.25)), null);
  }
  assert.equal(decodeState(encodeState(position, 5)), null);
});

test("damaged links are refused instead of crashing", () => {
  for (const text of ["", "not-a-link", "eyJ2IjoyfQ", "%%%"]) assert.equal(decodeState(text), null);
});
