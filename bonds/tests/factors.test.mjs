// The Factors tab's request: the window as fetched, and only the bond's terms.
import assert from "node:assert/strict";
import { test } from "node:test";

import { pcaRequest } from "../src/lib/state.ts";

test("pcaRequest sends the history as fetched and only the bond's terms", () => {
  const history = {
    day: "2026-11-20",
    years: 5,
    from: "2021-11-22",
    tenors: ["3 Mo", "6 Mo"],
    days: ["2021-11-22", "2021-11-23"],
    yields: [
      [0.05, null],
      [0.06, 0.07],
    ],
  };
  const bond = { preset: "UST", coupon: 4, maturity: "2036-11-15", mode: "price", cleanPrice: 97.5 };
  const request = pcaRequest(history, "MonotoneConvex", bond, 2_000_000, { years: 5, hedgeTenors: ["2 Yr", "10 Yr"] });
  assert.deepEqual(request, {
    history: { days: history.days, tenors: history.tenors, yields: history.yields },
    scheme: "MonotoneConvex",
    position: { preset: "UST", coupon: 4, maturity: "2036-11-15" },
    faceAmount: 2_000_000,
    hedgeTenors: ["2 Yr", "10 Yr"],
  });
});
