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
