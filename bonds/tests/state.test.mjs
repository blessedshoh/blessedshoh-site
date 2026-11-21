// Shareable links for the fixed income lab: what goes in comes out, and nothing out of bounds gets through.
import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeLab, encodeLab } from "../src/lib/state.ts";

test("the curve view on a past date round-trips", () => {
  const state = { area: "curve", day: "2004-12-31" };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

test("a bond and a hedge round-trip", () => {
  const state = {
    area: "hedge",
    day: null,
    bond: { preset: "UST", coupon: 4, maturity: "2036-11-15", mode: "curve", spreadBp: 25 },
    hedge: { faceAmount: 1000000, mode: "key-rate", tenors: ["2 Yr", "10 Yr"] },
  };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

test("a basics model with its inputs round-trips", () => {
  const state = { area: "basics", day: null, basics: { model: "tangent", inputs: { face: 100, coupon: 5, years: 50, frequency: 1, ytm: 5, shift: -4 } } };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

test("damaged and out-of-bounds links are refused", () => {
  const raw = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(decodeLab("%%%"), null);
  assert.equal(decodeLab(raw({ v: 2, a: "curve" })), null);
  assert.equal(decodeLab(raw({ v: 1, a: "nowhere" })), null);
  assert.equal(decodeLab(raw({ v: 1, a: "curve", d: "2004-13-45" })), null);
  assert.equal(decodeLab(raw({ v: 1, a: "price", b: { preset: "UST", coupon: 99, maturity: "2036-11-15", mode: "curve" } })), null);
  assert.equal(decodeLab(raw({ v: 1, a: "hedge", h: { faceAmount: 100, mode: "key-rate", tenors: ["2 Yr", "2 Yr"] } })), null);
  assert.equal(decodeLab(raw({ v: 1, a: "basics", m: { model: "nope", inputs: {} } })), null);
});

test("a factors view with bond, face amount, window and hedge tenors round-trips", () => {
  const state = {
    area: "factors",
    day: "2008-12-31",
    bond: { preset: "UST", coupon: 4.25, maturity: "2035-11-15", mode: "curve", spreadBp: 0 },
    hedge: { faceAmount: 5000000, mode: "key-rate", tenors: ["2 Yr", "10 Yr"] },
    factors: { years: 10, hedgeTenors: ["5 Yr", "30 Yr"] },
  };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

test("factors links out of bounds are refused", () => {
  const raw = (f) => Buffer.from(JSON.stringify({ v: 1, a: "factors", f })).toString("base64url");
  assert.notEqual(decodeLab(raw({ years: 5, hedgeTenors: ["2 Yr", "10 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: 3, hedgeTenors: ["2 Yr", "10 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: 5, hedgeTenors: ["2 Yr", "2 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: 5, hedgeTenors: ["1 Mo", "10 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: 5, hedgeTenors: ["10 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: "5", hedgeTenors: ["2 Yr", "10 Yr"] })), null);
  assert.equal(decodeLab(raw({ years: 5, hedgeTenors: ["2 Yr", "10 Yr"], extra: 1 })), null);
});
