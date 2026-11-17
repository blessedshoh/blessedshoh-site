// The whole position lives in the page address, so any view can be shared as a
// link. Format: #p=<base64url of a compact JSON object>.
//
// Nothing read from an address is trusted: it is checked against the same
// limits the API enforces before it reaches the screen or the server.

import type { Leg, LegKind, Position } from "./types.ts";

export const LIMITS = {
  legs: 8,
  spot: [0.01, 1_000_000],
  strike: [0.01, 1_000_000],
  vol: [0.01, 5],
  days: [0, 1825],
  quantity: 10_000,
  rate: [-0.05, 0.5],
  divYield: [0, 0.5],
  range: [0.02, 0.9],
  label: 12,
} as const;

const KIND_FROM_CODE: Record<string, LegKind> = { c: "call", p: "put", s: "stock" };

const inside = (value: unknown, [low, high]: readonly [number, number]): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

export function isValidLeg(leg: Leg): boolean {
  if (!Number.isFinite(leg.quantity) || leg.quantity === 0 || Math.abs(leg.quantity) > LIMITS.quantity) return false;
  if (leg.entry_price !== undefined && !inside(leg.entry_price, [0, 1_000_000])) return false;
  if (leg.kind === "stock") return true;
  return inside(leg.strike, LIMITS.strike) && inside(leg.days, LIMITS.days) && inside(leg.vol, LIMITS.vol);
}

export function isValidPosition(position: Position): boolean {
  return (
    inside(position.spot, LIMITS.spot) &&
    inside(position.rate, LIMITS.rate) &&
    inside(position.div_yield, LIMITS.divYield) &&
    position.legs.length >= 1 &&
    position.legs.length <= LIMITS.legs &&
    position.legs.every(isValidLeg)
  );
}

/** Only the fields the API knows about, in a fresh object. */
export function cleanLeg(leg: Leg): Leg {
  const paid = leg.entry_price === undefined ? {} : { entry_price: leg.entry_price };
  if (leg.kind === "stock") return { kind: "stock", quantity: leg.quantity, ...paid };
  return { kind: leg.kind, quantity: leg.quantity, strike: leg.strike, days: leg.days, vol: leg.vol, ...paid };
}

export function clonePosition(position: Position): Position {
  return {
    label: position.label,
    spot: position.spot,
    rate: position.rate,
    div_yield: position.div_yield,
    legs: position.legs.map(cleanLeg),
    exercise: position.exercise === "american" ? "american" : "european",
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(position: Position, rangePct: number): string {
  return toBase64Url(
    JSON.stringify({
      v: 1,
      t: position.label,
      s: position.spot,
      r: position.rate,
      q: position.div_yield,
      g: rangePct,
      x: position.exercise === "american" ? 1 : 0,
      l: position.legs.map((leg) => {
        const base = leg.kind === "stock" ? ["s", leg.quantity] : [leg.kind[0], leg.quantity, leg.strike, leg.days, leg.vol];
        return leg.entry_price === undefined ? base : [...base, leg.entry_price];
      }),
    }),
  );
}

export function decodeState(text: string): { position: Position; rangePct: number } | null {
  try {
    const raw = JSON.parse(fromBase64Url(text));
    if (raw?.v !== 1 || !Array.isArray(raw.l)) return null;
    const legs: Leg[] = raw.l.map((item: unknown[]) => {
      const kind = KIND_FROM_CODE[String(item[0])];
      if (!kind) throw new Error("unknown leg kind");
      const paidAt = kind === "stock" ? 2 : 5;
      const paid = item.length > paidAt ? { entry_price: Number(item[paidAt]) } : {};
      return kind === "stock"
        ? { kind, quantity: Number(item[1]), ...paid }
        : { kind, quantity: Number(item[1]), strike: Number(item[2]), days: Number(item[3]), vol: Number(item[4]), ...paid };
    });
    const position: Position = {
      label: String(raw.t ?? "").slice(0, LIMITS.label),
      spot: Number(raw.s),
      rate: Number(raw.r ?? 0),
      div_yield: Number(raw.q ?? 0),
      legs,
      exercise: raw.x === 1 ? "american" : "european",
    };
    const rangePct = Number(raw.g ?? 0.25);
    if (!isValidPosition(position) || !inside(rangePct, LIMITS.range)) return null;
    return { position, rangePct };
  } catch {
    return null;
  }
}
