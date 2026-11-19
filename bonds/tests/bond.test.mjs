// Bond and hedge inputs: limits that keep nonsense out of links and API calls.
import assert from "node:assert/strict";
import { test } from "node:test";

import { bondRequest, isValidBond, isValidHedge } from "../src/lib/state.ts";

const BOND = { preset: "UST", coupon: 4, maturity: "2036-11-15", mode: "curve", spreadBp: 0 };

test("a sensible bond is valid in every mode", () => {
  assert.equal(isValidBond(BOND), true);
  assert.equal(isValidBond({ ...BOND, mode: "yield", yield: 4.5 }), true);
  assert.equal(isValidBond({ ...BOND, mode: "price", cleanPrice: 97.5 }), true);
  assert.equal(isValidBond({ ...BOND, preset: "USD_CORP", spreadBp: 150 }), true);
});

test("bonds outside the limits are refused", () => {
  assert.equal(isValidBond({ ...BOND, coupon: 25 }), false);
  assert.equal(isValidBond({ ...BOND, coupon: -1 }), false);
  assert.equal(isValidBond({ ...BOND, maturity: "2036-02-30" }), false);
  assert.equal(isValidBond({ ...BOND, preset: "GILT" }), false);
  assert.equal(isValidBond({ ...BOND, mode: "guess" }), false);
  assert.equal(isValidBond({ ...BOND, spreadBp: 9000 }), false);
  assert.equal(isValidBond({ ...BOND, mode: "price", cleanPrice: 0 }), false);
});

test("the request carries only the field its mode needs", () => {
  const curve = { day: "2026-11-18", yields: { "10 Yr": 5.07 }, scheme: "MonotoneConvex" };
  assert.deepEqual(bondRequest(curve, { ...BOND, spreadBp: 25, yield: 9 }), {
    curve,
    bond: { preset: "UST", coupon: 4, maturity: "2036-11-15" },
    mode: "curve",
    spreadBp: 25,
  });
  assert.deepEqual(bondRequest(curve, { ...BOND, mode: "yield", yield: 4.5 }).yield, 4.5);
  assert.equal("spreadBp" in bondRequest(curve, { ...BOND, mode: "price", cleanPrice: 99 }), false);
});

test("hedges need distinct, known tenors: one for DV01, up to four for key rates", () => {
  assert.equal(isValidHedge({ faceAmount: 1e6, mode: "dv01", tenors: ["10 Yr"] }), true);
  assert.equal(isValidHedge({ faceAmount: 1e6, mode: "dv01", tenors: ["2 Yr", "10 Yr"] }), false);
  assert.equal(isValidHedge({ faceAmount: 1e6, mode: "key-rate", tenors: ["2 Yr", "5 Yr", "10 Yr", "30 Yr"] }), true);
  assert.equal(isValidHedge({ faceAmount: 1e6, mode: "key-rate", tenors: ["1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr"] }), false);
  assert.equal(isValidHedge({ faceAmount: 1e6, mode: "key-rate", tenors: ["3 Mo"] }), false);
  assert.equal(isValidHedge({ faceAmount: 0, mode: "dv01", tenors: ["10 Yr"] }), false);
});
