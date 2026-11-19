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
  exercise: "european",
};

test("a position survives the trip through a link", () => {
  assert.deepEqual(decodeState(encodeState(position, 0.3)), { position, rangePct: 0.3 });
});

test("American exercise survives the trip", () => {
  const american = { ...position, exercise: "american" };
  assert.equal(decodeState(encodeState(american, 0.25)).position.exercise, "american");
});

test("a stated entry price survives the trip", () => {
  const paid = { ...position, legs: [{ ...position.legs[0], entry_price: 7.25 }, position.legs[2]] };
  assert.equal(decodeState(encodeState(paid, 0.25)).position.legs[0].entry_price, 7.25);
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

// --- earnings events ----------------------------------------------------------

const withEvent = { ...position, legs: [position.legs[0]], event: { days: 5, move: 0.08 } };
const raw = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");

test("a link with an earnings event round-trips", () => {
  assert.deepEqual(decodeState(encodeState(withEvent, 0.25)).position.event, { days: 5, move: 0.08 });
});

test("links made before earnings existed still open, with no event", () => {
  // Made by the tool before this change.
  const old = "eyJ2IjoxLCJ0IjoiWFlaIiwicyI6MTY2LCJyIjowLjA0LCJxIjowLCJnIjowLjI1LCJ4IjowLCJsIjpbWyJjIiwxMCwxODAsMzAsMC42NF1dfQ";
  const decoded = decodeState(old);
  assert.ok(decoded);
  assert.equal(decoded.position.event, undefined);
  assert.equal(decoded.position.legs[0].strike, 180);
});

test("a position without an event puts nothing about it in the link", () => {
  const plain = { ...position, legs: [position.legs[0]] };
  const json = JSON.parse(Buffer.from(encodeState(plain, 0.25), "base64url").toString());
  assert.equal("e" in json, false);
});

test("links with a bad earnings event are refused", () => {
  const base = { v: 1, t: "X", s: 166, r: 0.04, q: 0, g: 0.25, x: 0, l: [["c", 1, 165, 30, 0.7]] };
  assert.equal(decodeState(raw({ ...base, e: [0.2, 0.08] })), null);
  assert.equal(decodeState(raw({ ...base, e: [5, 0.9] })), null);
  assert.equal(decodeState(raw({ ...base, e: "soon" })), null);
  assert.ok(decodeState(raw({ ...base, e: [5, 0.08] })));
});
