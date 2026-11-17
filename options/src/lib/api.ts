import { cleanLeg } from "./state.ts";
import type { GridResponse, Position } from "./types.ts";

/** Ask the pricing server for the whole profit grid of one position. */
export async function fetchGrid(
  apiBase: string,
  position: Position,
  rangePct: number,
  signal?: AbortSignal,
): Promise<GridResponse> {
  const response = await fetch(`${apiBase}/options/grid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spot: position.spot,
      rate: position.rate,
      div_yield: position.div_yield,
      legs: position.legs.map(cleanLeg),
      range_pct: rangePct,
    }),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : (body.detail?.[0]?.msg ?? "");
    } catch {
      // The body was not JSON. Fall through to the generic message.
    }
    throw new Error(detail || `The pricing server answered with status ${response.status}.`);
  }
  return response.json();
}
