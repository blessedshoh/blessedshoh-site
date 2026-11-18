import { cleanLeg } from "./state.ts";
import type {
  ArbitrageResponse,
  ChainRow,
  ConvergenceResponse,
  ExplainResponse,
  GridResponse,
  Position,
  Quote,
  RiskResponse,
  TreeResponse,
  WorkResponse,
} from "./types.ts";

function positionBody(position: Position, rangePct: number) {
  return {
    spot: position.spot,
    rate: position.rate,
    div_yield: position.div_yield,
    legs: position.legs.map(cleanLeg),
    range_pct: rangePct,
    exercise: position.exercise ?? "european",
  };
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json();
      detail = typeof parsed.detail === "string" ? parsed.detail : (parsed.detail?.[0]?.msg ?? "");
    } catch {
      // The body was not JSON. Fall through to the generic message.
    }
    throw new Error(detail || `The pricing server answered with status ${response.status}.`);
  }
  return response.json();
}

/** Ask the pricing server for the whole profit grid of one position. */
export function fetchGrid(apiBase: string, position: Position, rangePct: number, signal?: AbortSignal) {
  return post<GridResponse>(`${apiBase}/options/grid`, positionBody(position, rangePct), signal);
}

/** Chance of profit, price distribution and scenario grid. */
export function fetchRisk(
  apiBase: string,
  position: Position,
  rangePct: number,
  options: { drift: number | null; horizonDays: number },
  signal?: AbortSignal,
) {
  return post<RiskResponse>(
    `${apiBase}/options/risk`,
    { ...positionBody(position, rangePct), drift: options.drift, horizon_days: options.horizonDays },
    signal,
  );
}

/** Split a move's P/L into what each Greek predicts. */
export function fetchExplain(
  apiBase: string,
  position: Position,
  move: { pct: number; days: number; volPoints: number },
  signal?: AbortSignal,
) {
  return post<ExplainResponse>(
    `${apiBase}/options/explain`,
    { ...positionBody(position, 0.25), price_move_pct: move.pct, days_passed: move.days, vol_shift: move.volPoints / 100 },
    signal,
  );
}

export interface SingleOption {
  spot: number;
  strike: number;
  days: number;
  vol: number;
  rate: number;
  div_yield: number;
  kind: "call" | "put";
  american: boolean;
}

/** Every node of a small binomial tree, for drawing. */
export function fetchTree(apiBase: string, option: SingleOption, steps: number, signal?: AbortSignal) {
  return post<TreeResponse>(`${apiBase}/options/tree`, { ...option, steps }, signal);
}

/** Tree prices for 1 to 100 steps, both methods. */
export function fetchConvergence(apiBase: string, option: SingleOption, signal?: AbortSignal) {
  return post<ConvergenceResponse>(`${apiBase}/options/convergence`, { ...option, max_steps: 100 }, signal);
}

export interface SmileSettings {
  atm_vol: number;
  skew: number;
  curvature: number;
}

/** Model prices for every listed strike on a volatility smile. */
export function fetchChain(
  apiBase: string,
  market: { spot: number; days: number; rate: number; div_yield: number },
  smile: SmileSettings,
  signal?: AbortSignal,
) {
  return post<{ forward: number; rows: ChainRow[] }>(`${apiBase}/options/chain`, { ...market, ...smile }, signal);
}

/** Rule checks and the solver, on bid and ask quotes. */
export function fetchArbitrage(
  apiBase: string,
  market: { spot: number; days: number; rate: number; div_yield: number; american: boolean },
  quotes: Quote[],
  signal?: AbortSignal,
) {
  return post<ArbitrageResponse>(`${apiBase}/options/arbitrage`, { ...market, quotes }, signal);
}

export interface ReplicateResponse {
  holdings: { kind: "call" | "put" | "stock" | "cash"; quantity: number; strike: number | null; price: number }[];
  cost: number;
  max_error: number;
  prices: number[];
  target: number[];
  fitted: number[];
}

/** The portfolio closest to (or never below) a drawn expiry payoff. */
export function fetchReplicate(
  apiBase: string,
  request: {
    spot: number;
    days: number;
    rate: number;
    div_yield: number;
    atm_vol: number;
    target_prices: number[];
    target_payoffs: number[];
    mode: "match" | "cheapest";
    max_legs: number;
  },
  signal?: AbortSignal,
) {
  return post<ReplicateResponse>(`${apiBase}/options/replicate`, request, signal);
}

/** The intermediate values behind the cost, Greeks and chance of profit. */
export function fetchWork(apiBase: string, position: Position, signal?: AbortSignal) {
  return post<WorkResponse>(`${apiBase}/options/work`, positionBody(position, 0.25), signal);
}
