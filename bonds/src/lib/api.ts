// Calls to the Python API's /fixed-income routes. Every number comes back from bondlab.
import type { BondResponse, CurveResponse, HedgeResponse, PcaResponse } from "./types.ts";

export async function call<T>(apiBase: string, route: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase}/fixed-income/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = (await response.json()) as { detail?: unknown };
      detail = typeof parsed.detail === "string" ? parsed.detail : "";
    } catch {
      // Not JSON: fall back to the status below.
    }
    throw new Error(detail || `The pricing server answered with status ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const fetchCurve = (apiBase: string, body: unknown, signal?: AbortSignal) => call<CurveResponse>(apiBase, "treasury-curve", body, signal);
export const fetchBond = (apiBase: string, body: unknown, signal?: AbortSignal) => call<BondResponse>(apiBase, "bond", body, signal);
export const fetchHedge = (apiBase: string, body: unknown, signal?: AbortSignal) => call<HedgeResponse>(apiBase, "hedge", body, signal);
export const fetchPca = (apiBase: string, body: unknown, signal?: AbortSignal) => call<PcaResponse>(apiBase, "pca", body, signal);
export const fetchBasics = <T>(apiBase: string, route: "basics" | "rate-tree" | "convertible", body: unknown, signal?: AbortSignal) =>
  call<T>(apiBase, route, body, signal);
