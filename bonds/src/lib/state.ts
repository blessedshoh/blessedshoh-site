// The lab's state lives in the page address so any view can be shared as a link.
// Format: #l=<base64url of a compact JSON object>. Nothing read from an address is trusted.

import { MODELS } from "./basics.ts";
import type { StoredHistory } from "./history-data.ts";
import {
  AREAS,
  BASICS_MODELS,
  FACTOR_YEARS,
  HEDGE_TENORS,
  type Area,
  type BasicsInput,
  type BondInput,
  type CurveInput,
  type FactorsInput,
  type HedgeInput,
  type LabState,
  type Scheme,
} from "./types.ts";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const inside = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

export function isIsoDay(text: unknown): text is string {
  if (typeof text !== "string" || !ISO_DAY.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidBond(bond: BondInput | undefined): bond is BondInput {
  if (!bond || (bond.preset !== "UST" && bond.preset !== "USD_CORP")) return false;
  if (!inside(bond.coupon, 0, 20) || !isIsoDay(bond.maturity)) return false;
  if (bond.mode !== "curve" && bond.mode !== "yield" && bond.mode !== "price") return false;
  if (bond.spreadBp !== undefined && !inside(bond.spreadBp, -500, 5000)) return false;
  if (bond.yield !== undefined && !inside(bond.yield, -5, 50)) return false;
  if (bond.cleanPrice !== undefined && !inside(bond.cleanPrice, 1, 500)) return false;
  return true;
}

export function isValidHedge(hedge: HedgeInput | undefined): hedge is HedgeInput {
  if (!hedge || !inside(hedge.faceAmount, 1, 1e10)) return false;
  if (hedge.mode !== "dv01" && hedge.mode !== "key-rate") return false;
  if (!Array.isArray(hedge.tenors) || new Set(hedge.tenors).size !== hedge.tenors.length) return false;
  if (!hedge.tenors.every((t) => (HEDGE_TENORS as readonly string[]).includes(t))) return false;
  return hedge.mode === "dv01" ? hedge.tenors.length === 1 : hedge.tenors.length >= 1 && hedge.tenors.length <= 4;
}

/** A window length and two different hedge maturities, and nothing else. */
export function isValidFactors(factors: FactorsInput | undefined): factors is FactorsInput {
  if (!factors || typeof factors !== "object" || Object.keys(factors).length !== 2) return false;
  if (!(FACTOR_YEARS as readonly unknown[]).includes(factors.years)) return false;
  const tenors = factors.hedgeTenors as unknown;
  if (!Array.isArray(tenors) || tenors.length !== 2 || tenors[0] === tenors[1]) return false;
  return tenors.every((t) => (HEDGE_TENORS as readonly unknown[]).includes(t));
}

/** A model and inputs holding exactly that model's fields, each of the right kind. Limits are basicsProblem's job. */
export function isValidBasics(basics: BasicsInput | undefined): basics is BasicsInput {
  if (!basics || !(BASICS_MODELS as readonly string[]).includes(basics.model)) return false;
  const inputs = basics.inputs as unknown;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) return false;
  const given = inputs as Record<string, unknown>;
  const fields = MODELS[basics.model].fields;
  if (Object.keys(given).length !== fields.length) return false;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return fields.every((f) => {
    const v = given[f.key];
    if (f.kind === "bool") return typeof v === "boolean";
    if (f.kind === "choice") return (f.choices ?? []).some(([c]) => c === v);
    if (f.kind === "list") return Array.isArray(v) && v.length <= 30 && v.every(finite);
    return finite(v);
  });
}

/**
 * The hedge with any maturity the day did not publish removed, so it can still be solved
 * (no 30-year from 2002 to 2006, for one). Returns the same object when nothing changes.
 */
export function fitHedgeToDay(hedge: HedgeInput, available: readonly string[]): HedgeInput {
  const kept = hedge.tenors.filter((t) => available.includes(t));
  if (kept.length === hedge.tenors.length) return hedge;
  const fallback = available.includes("10 Yr") ? "10 Yr" : (HEDGE_TENORS.filter((t) => available.includes(t)).at(-1) ?? "10 Yr");
  return { ...hedge, tenors: kept.length > 0 ? kept : [fallback] };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

export function encodeLab(state: LabState): string {
  return toBase64Url(
    JSON.stringify({
      v: 1,
      a: state.area,
      ...(state.day ? { d: state.day } : {}),
      ...(state.bond ? { b: state.bond } : {}),
      ...(state.hedge ? { h: state.hedge } : {}),
      ...(state.basics ? { m: state.basics } : {}),
      ...(state.factors ? { f: state.factors } : {}),
    }),
  );
}

export function decodeLab(text: string): LabState | null {
  try {
    const raw = JSON.parse(fromBase64Url(text));
    if (raw?.v !== 1 || !(AREAS as readonly string[]).includes(raw.a)) return null;
    if (raw.d !== undefined && !isIsoDay(raw.d)) return null;
    if (raw.b !== undefined && !isValidBond(raw.b)) return null;
    if (raw.h !== undefined && !isValidHedge(raw.h)) return null;
    if (raw.m !== undefined && !isValidBasics(raw.m)) return null;
    if (raw.f !== undefined && !isValidFactors(raw.f)) return null;
    return {
      area: raw.a as Area,
      day: raw.d ?? null,
      ...(raw.b ? { bond: raw.b as BondInput } : {}),
      ...(raw.h ? { hedge: raw.h as HedgeInput } : {}),
      ...(raw.m ? { basics: raw.m as BasicsInput } : {}),
      ...(raw.f ? { factors: raw.f as FactorsInput } : {}),
    };
  } catch {
    return null;
  }
}

/** The bond route's request: the curve, the bond's terms, and only the input its mode needs. */
export function bondRequest(curve: CurveInput, bond: BondInput) {
  const terms = { preset: bond.preset, coupon: bond.coupon, maturity: bond.maturity };
  const extra =
    bond.mode === "curve" ? { spreadBp: bond.spreadBp ?? 0 } : bond.mode === "yield" ? { yield: bond.yield ?? 0 } : { cleanPrice: bond.cleanPrice ?? 100 };
  return { curve, bond: terms, mode: bond.mode, ...extra };
}

/** The hedge route's request: the pricer's bond terms as the position, plus the hedge settings. */
export function hedgeRequest(curve: CurveInput, bond: BondInput, hedge: HedgeInput) {
  return {
    curve,
    position: { preset: bond.preset, coupon: bond.coupon, maturity: bond.maturity },
    faceAmount: hedge.faceAmount,
    mode: hedge.mode,
    hedgeTenors: [...hedge.tenors],
  };
}

/** The factors route's request: the window as fetched, the pricer's bond terms, the hedge settings. */
export function pcaRequest(history: StoredHistory, scheme: Scheme, bond: BondInput, faceAmount: number, factors: FactorsInput) {
  return {
    history: { days: history.days, tenors: history.tenors, yields: history.yields },
    scheme,
    position: { preset: bond.preset, coupon: bond.coupon, maturity: bond.maturity },
    faceAmount,
    hedgeTenors: [...factors.hedgeTenors],
  };
}
