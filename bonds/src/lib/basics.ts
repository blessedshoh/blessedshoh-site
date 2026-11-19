// The coursework models: their form fields, input limits, and the request each one sends.
// Every number shown comes from the API; nothing here does finance.

import type { BasicsModel } from "./types.ts";

export type Inputs = Record<string, number | boolean | string | number[]>;

export interface Field {
  key: string;
  label: string;
  kind: "number" | "int" | "list" | "choice" | "bool";
  min?: number;
  max?: number;
  step?: number;
  choices?: [string | number, string][];
  /** Shown only when this returns true. */
  when?: (inputs: Inputs) => boolean;
}

export interface ModelInfo {
  title: string;
  fields: Field[];
}

const FREQ: Field = { key: "frequency", label: "Payments a year", kind: "choice", choices: [[1, "Annual"], [2, "Semiannual"], [4, "Quarterly"], [12, "Monthly"]] };
const FACE: Field = { key: "face", label: "Face", kind: "number", min: 1, max: 1e9, step: 100 };
const pct = (key: string, label: string, min = 0, max = 50): Field => ({ key, label, kind: "number", min, max, step: 0.25 });
const yrs = (key: string, label: string, max = 100): Field => ({ key, label, kind: "int", min: 1, max, step: 1 });

export const MODELS: Record<BasicsModel, ModelInfo> = {
  price: { title: "Bond price", fields: [FACE, pct("coupon", "Coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield %")] },
  coupon: { title: "Coupon effect", fields: [FACE, pct("lowCoupon", "Low coupon %"), pct("highCoupon", "High coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield %")] },
  maturity: { title: "Maturity effect", fields: [FACE, pct("coupon", "Coupon %"), yrs("shortYears", "Short bond, years"), yrs("longYears", "Long bond, years"), FREQ, pct("ytm", "Yield %")] },
  "time-path": { title: "Price over time", fields: [FACE, pct("lowCoupon", "Discount bond coupon %"), pct("highCoupon", "Premium bond coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield %")] },
  "yield-change": {
    title: "Yield change",
    fields: [FACE, pct("coupon", "Coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield before %"), pct("newYtm", "Yield after %"), { key: "yearOfChange", label: "Changes in year", kind: "int", min: 0, max: 99, step: 1 }],
  },
  duration: { title: "Duration and convexity", fields: [FACE, pct("coupon", "Coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield %")] },
  tangent: { title: "Duration's tangent line", fields: [FACE, pct("coupon", "Coupon %"), yrs("years", "Years"), FREQ, pct("ytm", "Yield %"), pct("shift", "Yield shift, % points", -10, 10)] },
  bootstrap: {
    title: "Bootstrapping spot rates",
    fields: [
      { key: "parYields", label: "Par yields %", kind: "list", min: 0, max: 50, step: 0.05 },
      FREQ,
      { key: "billPeriods", label: "Periods priced as bills", kind: "int", min: 0, max: 30, step: 1 },
    ],
  },
  "rate-tree": {
    title: "Callable bond on a rate tree",
    fields: [
      { key: "source", label: "Rates from", kind: "choice", choices: [["tree", "The workbook's tree"], ["par", "Fit to par yields"]] },
      pct("volatility", "Rate volatility %", 0.01, 100),
      { key: "lowestRates", label: "Lowest rate per year %", kind: "list", min: -5, max: 50, step: 0.05, when: (i) => i.source === "tree" },
      { key: "parYields", label: "Par yields %", kind: "list", min: -5, max: 50, step: 0.05, when: (i) => i.source === "par" },
      FACE,
      pct("coupon", "Coupon %"),
      yrs("years", "Years", 30),
      { key: "option", label: "Option", kind: "choice", choices: [["call", "Callable"], ["put", "Putable"], ["none", "None"]] },
      { key: "strike", label: "Exercise price", kind: "number", min: 0.01, max: 1e9, step: 0.5, when: (i) => i.option !== "none" },
      { key: "firstExerciseYear", label: "First exercise year", kind: "int", min: 1, max: 30, step: 1 },
    ],
  },
  convertible: {
    title: "Convertible bond",
    fields: [
      FACE,
      pct("coupon", "Coupon %"),
      { key: "conversionRatio", label: "Shares per bond", kind: "number", min: 0.0001, max: 1e6, step: 1 },
      yrs("years", "Years", 50),
      { key: "couponOnConversion", label: "Coupon paid in the year it converts", kind: "bool" },
      { key: "stockPrice", label: "Stock price", kind: "number", min: 0.0001, max: 1e7, step: 1 },
      pct("volatility", "Stock volatility %", 0.01, 200),
      pct("rate", "Risk-free rate %", -5, 50),
      pct("dividendYield", "Dividend yield %", 0, 50),
    ],
  },
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The first thing wrong with these inputs, in words, or "" when they are fine. */
export function basicsProblem(model: BasicsModel, inputs: Inputs): string {
  for (const f of MODELS[model].fields) {
    if (f.when && !f.when(inputs)) continue;
    const v = inputs[f.key];
    if (f.kind === "choice") {
      if (!f.choices!.some(([c]) => c === v)) {
        return f.key === "frequency" ? "Payments a year must be 1, 2, 4 or 12." : `${f.label}: choose one of the options.`;
      }
    } else if (f.kind === "bool") {
      if (typeof v !== "boolean") return `${f.label}: yes or no.`;
    } else if (f.kind === "list") {
      if (!Array.isArray(v) || v.length === 0 || v.length > 30) return `${f.label}: give 1 to 30 par yield or rate values.`;
      if (!v.every((x) => finite(x) && x >= f.min! && x <= f.max!)) return `${f.label}: each value between ${f.min} and ${f.max}.`;
    } else {
      if (!finite(v) || v < f.min! || v > f.max!) return `${f.label} must be between ${f.min} and ${f.max}.`;
      if (f.kind === "int" && !Number.isInteger(v)) return `${f.label} must be a whole number.`;
    }
  }
  if (model === "yield-change" && (inputs.yearOfChange as number) >= (inputs.years as number)) return "The yield must change within the bond's life (before its last year).";
  if (model === "bootstrap" && (inputs.billPeriods as number) > (inputs.parYields as number[]).length) return "Periods priced as bills cannot exceed the number of par yields.";
  if (model === "rate-tree") {
    const rates = (inputs.source === "tree" ? inputs.lowestRates : inputs.parYields) as number[];
    if ((inputs.years as number) > rates.length) return `The tree has ${rates.length} years of rates; years must not exceed that.`;
    if ((inputs.firstExerciseYear as number) > (inputs.years as number)) return "The first exercise year must fall within the bond's life.";
  }
  return "";
}

/** The route and body for a model: only the fields that route reads. */
export function basicsRequest(model: BasicsModel, inputs: Inputs): { route: "basics" | "rate-tree" | "convertible"; body: Inputs } {
  if (model === "convertible") return { route: "convertible", body: { ...inputs } };
  if (model === "rate-tree") {
    const { source, lowestRates, parYields, strike, ...rest } = inputs;
    return {
      route: "rate-tree",
      body: { ...rest, ...(source === "tree" ? { lowestRates } : { parYields }), ...(inputs.option !== "none" ? { strike } : {}) },
    };
  }
  return { route: "basics", body: { model, ...inputs } };
}
