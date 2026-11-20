// Shapes shared by the fixed income lab. They mirror bondlab's lab routes
// (bondlab/src/bondlab/ui/lab_service.py): rates in percent, spreads in basis points.

export type Area = "curve" | "price" | "hedge" | "basics";
export const AREAS: readonly Area[] = ["curve", "price", "hedge", "basics"];

export const TENORS = ["1 Mo", "1.5 Month", "2 Mo", "3 Mo", "4 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"] as const;
/** Maturities a hedge can use: on-the-run notes and bonds, one year and longer. */
export const HEDGE_TENORS = ["1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"] as const;

export type Scheme = "MonotoneConvex" | "LinearOnZeroRate" | "NaturalCubicSpline";
export const SCHEMES: readonly Scheme[] = ["MonotoneConvex", "LinearOnZeroRate", "NaturalCubicSpline"];

export interface CurveInput {
  day: string;
  yields: Record<string, number>;
  scheme: Scheme;
}

export interface BondInput {
  preset: "UST" | "USD_CORP";
  coupon: number;
  maturity: string;
  mode: "curve" | "yield" | "price";
  spreadBp?: number;
  yield?: number;
  cleanPrice?: number;
}

export interface HedgeInput {
  faceAmount: number;
  mode: "dv01" | "key-rate";
  tenors: string[];
}

export const BASICS_MODELS = ["price", "coupon", "maturity", "time-path", "yield-change", "duration", "tangent", "bootstrap", "rate-tree", "convertible"] as const;
export type BasicsModel = (typeof BASICS_MODELS)[number];

export interface BasicsInput {
  model: BasicsModel;
  inputs: Record<string, number | boolean | string | number[]>;
}

export interface LabState {
  area: Area;
  /** null means the latest stored day. */
  day: string | null;
  bond?: BondInput;
  hedge?: HedgeInput;
  basics?: BasicsInput;
}

export interface CurvePillar {
  tenor: string;
  date: string;
  years: number;
  parYield: number;
  zero: number;
  discountFactor: number;
}

export interface CurveGridPoint {
  years: number;
  zero: number;
  zeroContinuous: number;
  forward: number | null;
  par: number | null;
}

export interface CurveResponse {
  day: string;
  scheme: string;
  used: string[];
  missing: string[];
  pillars: CurvePillar[];
  grid: CurveGridPoint[];
  nelsonSiegel: { beta0: number; beta1: number; beta2: number; decay: number; grid: { years: number; zero: number; zeroContinuous: number }[] };
}

export interface KeyRate {
  tenor: string;
  date: string;
  duration: number;
  dv01: number;
}

export interface CashflowRow {
  date: string;
  yearFraction: number;
  amount: number;
  discountFactor: number;
  presentValue: number;
}

export interface BondResponse {
  settlement: string;
  issueDate: string;
  cleanPrice: number;
  accrued: number;
  dirtyPrice: number;
  yield: number;
  zSpreadBp: number;
  macaulay: number;
  modified: number;
  convexity: number;
  dv01: number;
  keyRates: KeyRate[];
  cashflows: CashflowRow[];
}

export interface HedgeResponse {
  positionDv01: number;
  netDv01: number;
  hedges: { tenor: string; coupon: number; face: number; maturity: string }[];
  keyRates: { tenor: string; date: string; before: number; after: number }[];
}

/** One line, dashed line, dotted line or set of dots on a chart. */
export interface ChartSeries {
  key: string;
  label: string;
  points: { x: number; y: number }[];
  style: "line" | "dash" | "dot" | "points";
  color: string;
}
