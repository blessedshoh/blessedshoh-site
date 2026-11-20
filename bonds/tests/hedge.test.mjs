// The hedge route's request: the pricer's bond as the position, the hedge settings, nothing else.
import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeLab, encodeLab, hedgeRequest } from "../src/lib/state.ts";

const CURVE = { day: "2026-11-18", yields: { "10 Yr": 5.07 }, scheme: "MonotoneConvex" };
const BOND = { preset: "UST", coupon: 4, maturity: "2036-11-15", mode: "yield", yield: 4.5 };
const HEDGE = { faceAmount: 1_000_000, mode: "key-rate", tenors: ["2 Yr", "10 Yr"] };

test("the request carries the bond's terms as the position, not how it was priced", () => {
  assert.deepEqual(hedgeRequest(CURVE, BOND, HEDGE), {
    curve: CURVE,
    position: { preset: "UST", coupon: 4, maturity: "2036-11-15" },
    faceAmount: 1_000_000,
    mode: "key-rate",
    hedgeTenors: ["2 Yr", "10 Yr"],
  });
});

test("the request's tenor list is a copy, not the live state", () => {
  const request = hedgeRequest(CURVE, BOND, HEDGE);
  request.hedgeTenors.push("30 Yr");
  assert.deepEqual(HEDGE.tenors, ["2 Yr", "10 Yr"]);
});

test("a hedge survives the round trip through a link", () => {
  const state = { area: "hedge", day: null, bond: { ...BOND }, hedge: { ...HEDGE, mode: "dv01", tenors: ["10 Yr"] } };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

import { fitHedgeToDay } from "../src/lib/state.ts";

// 2004: no 30-year yield was published from February 2002 to February 2006.
const DAY_2004 = ["1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr"];

test("maturities a day lacks are dropped from the hedge, so it can still be solved", () => {
  assert.deepEqual(fitHedgeToDay({ ...HEDGE, tenors: ["2 Yr", "5 Yr", "10 Yr", "30 Yr"] }, DAY_2004).tenors, ["2 Yr", "5 Yr", "10 Yr"]);
  const dv01 = { ...HEDGE, mode: "dv01", tenors: ["30 Yr"] };
  assert.deepEqual(fitHedgeToDay(dv01, DAY_2004).tenors, ["10 Yr"]);
  const nothingLeft = { ...HEDGE, tenors: ["30 Yr"] };
  assert.deepEqual(fitHedgeToDay(nothingLeft, DAY_2004).tenors, ["10 Yr"]);
});

test("a hedge the day can already solve is returned unchanged", () => {
  const hedge = { ...HEDGE, tenors: ["2 Yr", "10 Yr"] };
  assert.equal(fitHedgeToDay(hedge, DAY_2004), hedge);
});
