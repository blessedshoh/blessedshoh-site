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
}

export interface Position {
  /** Free text shown next to the strategy name, usually a ticker. */
  label: string;
  spot: number;
  rate: number;
  div_yield: number;
  legs: Leg[];
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
