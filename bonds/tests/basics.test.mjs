// The coursework models open on the workbook's own inputs, so their first numbers are the
// workbook's. The expected values here are the golden rows of bondlab/tests/golden.
import assert from "node:assert/strict";
import { test } from "node:test";

import DEFAULTS from "../src/data/basics-defaults.json" with { type: "json" };
import { basicsProblem, basicsRequest, MODELS } from "../src/lib/basics.ts";
import { decodeLab, encodeLab } from "../src/lib/state.ts";
import { BASICS_MODELS } from "../src/lib/types.ts";

const WORKBOOK = {
  price: [{ face: 100, coupon: 0, years: 20, frequency: 1, ytm: 10 }, { price: 14.8643628024 }],
  coupon: [{ face: 100, lowCoupon: 0, highCoupon: 20, years: 20, frequency: 1, ytm: 10 }, { low: 14.8643628024, high: 185.1356371975 }],
  maturity: [{ face: 100, coupon: 5, shortYears: 2, longYears: 20, frequency: 1, ytm: 10 }, { short: 91.3223140496, long: 57.4321814012 }],
  "time-path": [{ face: 100, lowCoupon: 4, highCoupon: 12, years: 20, frequency: 1, ytm: 8 }, { "path[0].low": 60.7274103702, "path[0].high": 139.2725896297 }],
  "yield-change": [{ face: 100, coupon: 2, years: 20, frequency: 1, ytm: 8, newYtm: 2, yearOfChange: 7 }, { "path[0].actual": 41.0911155553, "path[7].actual": 100 }],
  duration: [{ face: 100, coupon: 8, years: 20, frequency: 1, ytm: 2 }, { macaulay: 13.293500661, modified: 13.0328437853 }],
  tangent: [{ face: 100, coupon: 5, years: 50, frequency: 1, ytm: 5, shift: -4 }, { price: 100, modified: 18.2559254606, convexity: 564.1346813318, durationEstimate: 173.0237018422, durationConvexityEstimate: 218.1544763487, truePrice: 256.7844701244 }],
  bootstrap: [{ parYields: [5, 5.25, 5.8, 6, 6.2, 6.5], frequency: 2, billPeriods: 2 }, { "spots[2]": 5.8186247396, "spots[5]": 6.5542833542 }],
  "rate-tree": [{ source: "tree", volatility: 10, lowestRates: [3.5, 4.07361919503, 3.24627558493], parYields: [3.5, 4.2, 4.7], face: 100, coupon: 4, years: 3, option: "call", strike: 100, firstExerciseYear: 1 }, { value: 99.8150009406 }],
  convertible: [{ face: 1000, coupon: 10, conversionRatio: 15, years: 3, couponOnConversion: true, stockPrice: 100, volatility: 20, rate: 5, dividendYield: 9 }, { value: 1504.0110866921, upProbability: 0.352790073 }],
};

test("every model has defaults, and they are the workbook's inputs", () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), [...BASICS_MODELS].sort());
  for (const model of BASICS_MODELS) {
    assert.deepEqual(DEFAULTS[model].inputs, WORKBOOK[model][0], model);
  }
});

test("each model carries the workbook's numbers for those inputs, with the cell they came from", () => {
  for (const model of BASICS_MODELS) {
    const expected = WORKBOOK[model][1];
    const carried = Object.fromEntries(DEFAULTS[model].workbook.map((w) => [w.field, w.value]));
    assert.deepEqual(carried, expected, model);
    for (const w of DEFAULTS[model].workbook) assert.match(w.cell, /^(FixedIncomeDeriv_ All_Models\.xlsm|FI_final_ShohruhM\.xlsx), .+!/, model);
  }
});

test("every model has a title and a form field for each of its inputs", () => {
  for (const model of BASICS_MODELS) {
    assert.ok(MODELS[model].title, model);
    const fields = MODELS[model].fields.map((f) => f.key).sort();
    assert.deepEqual(fields, Object.keys(DEFAULTS[model].inputs).sort(), model);
  }
});

test("the defaults pass the input limits; nonsense does not", () => {
  for (const model of BASICS_MODELS) assert.equal(basicsProblem(model, DEFAULTS[model].inputs), "", model);
  assert.match(basicsProblem("price", { ...DEFAULTS.price.inputs, years: 0 }), /years/i);
  assert.match(basicsProblem("price", { ...DEFAULTS.price.inputs, frequency: 3 }), /payments a year/i);
  assert.match(basicsProblem("bootstrap", { ...DEFAULTS.bootstrap.inputs, parYields: [] }), /par yield/i);
  assert.match(basicsProblem("rate-tree", { ...DEFAULTS["rate-tree"].inputs, firstExerciseYear: 9 }), /first/i);
});

test("requests go to the right route and carry only what that route reads", () => {
  assert.deepEqual(basicsRequest("price", DEFAULTS.price.inputs), { route: "basics", body: { model: "price", ...DEFAULTS.price.inputs } });
  const tree = basicsRequest("rate-tree", DEFAULTS["rate-tree"].inputs);
  assert.equal(tree.route, "rate-tree");
  assert.deepEqual(tree.body.lowestRates, [3.5, 4.07361919503, 3.24627558493]);
  assert.equal("parYields" in tree.body, false);
  assert.equal("source" in tree.body, false);
  const fitted = basicsRequest("rate-tree", { ...DEFAULTS["rate-tree"].inputs, source: "par", option: "none" });
  assert.deepEqual(fitted.body.parYields, [3.5, 4.2, 4.7]);
  assert.equal("lowestRates" in fitted.body, false);
  assert.equal("strike" in fitted.body, false);
  assert.equal(basicsRequest("convertible", DEFAULTS.convertible.inputs).route, "convertible");
});

test("a model and its inputs survive the round trip through a link", () => {
  const state = { area: "basics", day: null, basics: { model: "rate-tree", inputs: { ...DEFAULTS["rate-tree"].inputs } } };
  assert.deepEqual(decodeLab(encodeLab(state)), state);
});

test("workbook fields are read out of a result by their path", async () => {
  const { readPath } = await import("../src/lib/basics.ts");
  const result = { price: 14.86, path: [{ low: 60.7 }, { low: 61.5 }], spots: [5, 5.25, 5.81] };
  assert.equal(readPath(result, "price"), 14.86);
  assert.equal(readPath(result, "path[1].low"), 61.5);
  assert.equal(readPath(result, "spots[2]"), 5.81);
  assert.equal(readPath(result, "path[9].low"), undefined);
});

test("the final exam's callable bond is offered as a preset with its own answer", () => {
  const [exam] = DEFAULTS["rate-tree"].presets;
  assert.deepEqual(exam.inputs.lowestRates, [4.858, 4.429295078145, 3.702950670663, 3.191253030166, 2.753050362923]);
  assert.deepEqual([exam.inputs.face, exam.inputs.coupon, exam.inputs.years, exam.inputs.strike, exam.inputs.firstExerciseYear, exam.inputs.volatility], [1000, 5, 5, 985, 3, 14.16]);
  assert.deepEqual(exam.workbook, [{ field: "value", value: 982.2212369016, cell: "FI_final_ShohruhM.xlsx, Q1!C21" }]);
  assert.equal(basicsProblem("rate-tree", exam.inputs), "");
});
