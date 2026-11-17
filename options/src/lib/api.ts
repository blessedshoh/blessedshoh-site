import { cleanLeg } from "./state.ts";
import type { ExplainResponse, GridResponse, Position, RiskResponse } from "./types.ts";

function positionBody(position: Position, rangePct: number) {
  return {
    spot: position.spot,
    rate: position.rate,
    div_yield: position.div_yield,
    legs: position.legs.map(cleanLeg),
    range_pct: rangePct,
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
