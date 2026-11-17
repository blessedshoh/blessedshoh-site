// Shapes shared by the front end. They mirror the request and response models
// in quant-core/api/main.py.

export type LegKind = "call" | "put" | "stock";

export interface Leg {
  kind: LegKind;
  /** Contracts for options, shares for stock. Negative is short. */
  quantity: number;
  strike?: number;
  /** Calendar days to expiry. */
  days?: number;
  /** Implied volatility as a decimal: 0.64 is 64%. */
  vol?: number;
  /** Price per share actually paid or received. Empty means the model price today. */
  entry_price?: number;
}

export interface Position {
  /** Free text shown next to the strategy name, usually a ticker. */
  label: string;
  spot: number;
  rate: number;
  div_yield: number;
  legs: Leg[];
  /** "american" values every option with a binomial tree that allows early exercise. */
  exercise?: Exercise;
}

export type Exercise = "european" | "american";

export interface TreeResponse {
  /** Row i holds the i + 1 nodes after i steps, lowest price first. */
  prices: number[][];
  values: number[][];
  exercise: boolean[][];
  p: number;
  u: number;
  d: number;
  dt_days: number;
  european_value: number;
  american_value: number;
}

export interface ChainRow {
  strike: number;
  vol: number;
  call: number;
  put: number;
  call_delta: number;
  put_delta: number;
}

export interface Quote {
  strike: number;
  call_bid: number | null;
  call_ask: number | null;
  put_bid: number | null;
  put_ask: number | null;
}

export interface TradeLeg {
  kind: "call" | "put" | "stock" | "cash";
  /** Per share. Positive is bought; for cash, money lent today. */
  quantity: number;
  strike: number | null;
  price: number;
}

export interface ArbitrageResponse {
  violations: {
    rule: "bound" | "parity" | "order" | "spread" | "butterfly";
    title: string;
    detail: string;
    profit: number;
    strikes: number[];
    trade: TradeLeg[];
  }[];
  solver: { arbitrage: boolean; credit: number; trade: TradeLeg[]; worst_payoff: number } | null;
  assumptions: string[];
}

export interface ConvergenceResponse {
  steps: number[];
  crr: number[];
  leisen_reimer: number[];
  black_scholes: number;
  reference: number;
}

export interface Summary {
  /** Positive is a net debit, negative a net credit. */
  entry_cost: number;
  first_expiry_days: number | null;
  breakevens: number[];
  /** null means unlimited. */
  max_profit: number | null;
  /** A negative number. null means unlimited. */
  max_loss: number | null;
  legs: { entry_price: number }[];
}

export interface GridResponse {
  axes: { prices: number[]; days: number[]; vol_scales: number[] };
  /** Profit at every (vol_scale, day, price), flattened row by row. */
  profit: { shape: [number, number, number]; values: number[] };
  /** Position Greeks at the current spot, each indexed [vol_scale][day]. */
  greeks: { delta: number[][]; gamma: number[][]; theta_per_day: number[][]; vega_per_point: number[][] };
  summary: Summary;
}

export interface RiskResponse {
  representative_vol: number | null;
  /** Risk-neutral, at the first expiry. */
  chance_of_profit: number | null;
  chance_of_profit_with_drift: number | null;
  expected_profit: number | null;
  distribution: {
    days: number;
    vol: number;
    prices: number[];
    density: number[];
    below_range: number;
    above_range: number;
  } | null;
  scenarios: {
    price_shocks: number[];
    vol_shifts: number[];
    horizon_days: number;
    /** Indexed [vol_shift][price_shock]. */
    profit: number[][];
  };
}

export interface ExplainResponse {
  price_move: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  unexplained: number;
  actual: number;
}

export interface RiskDefaults {
  move_pct: number;
  days: number;
  vol_points: number;
}

export interface Settings {
  api_base: string;
  default_position: Position;
  default_range_pct: number;
  risk_defaults: RiskDefaults;
  /** Feature switches. A missing key means off. */
  flags: Record<string, boolean>;
  /** Optional notice shown above the tool. */
  banner: string | null;
  projects: { title: string; url: string; current?: boolean }[];
}
