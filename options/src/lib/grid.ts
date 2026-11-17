// Reading the profit grid. The server prices every (volatility, day, price)
// combination once. Everything here only interpolates between those numbers,
// which is what lets the sliders move without asking the server again.
//
// This is a line-for-line port of Grid.at in quant-core/src/quantcore/grid.py.
// tests/grid.test.mjs checks the two against each other.

import type { GridResponse } from "./types.ts";

export interface Cube {
  prices: Float64Array;
  days: Float64Array;
  vols: Float64Array;
  /** Profit, indexed (vol * nD + day) * nP + price. */
  values: Float64Array;
  nV: number;
  nD: number;
  nP: number;
}

export function toCube(response: GridResponse): Cube {
  const [nV, nD, nP] = response.profit.shape;
  return {
    prices: Float64Array.from(response.axes.prices),
    days: Float64Array.from(response.axes.days),
    vols: Float64Array.from(response.axes.vol_scales),
    values: Float64Array.from(response.profit.values),
    nV,
    nD,
    nP,
  };
}

/** Indices of the two grid points around x, and how far x sits between them (0 to 1). */
export function bracket(axis: ArrayLike<number>, x: number): [number, number, number] {
  const n = axis.length;
  if (n === 1) return [0, 0, 0];
  const clamped = Math.min(Math.max(x, axis[0]), axis[n - 1]);
  let lower = 0;
  let upper = n - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >> 1;
    if (axis[middle] <= clamped) lower = middle;
    else upper = middle;
  }
  const span = axis[upper] - axis[lower];
  return [lower, upper, span === 0 ? 0 : (clamped - axis[lower]) / span];
}

/**
 * The same as `bracket` for the date axis, except the weight is measured in the
 * SQUARE ROOT of the time left. An option's time value shrinks that way, so
 * reading the date in plain days would overstate the decay in the final hours.
 */
export function dayBracket(days: ArrayLike<number>, day: number): [number, number, number] {
  const [lower, upper] = bracket(days, day);
  const last = days[days.length - 1];
  const clamped = Math.min(Math.max(day, days[0]), last);
  const root0 = Math.sqrt(last - days[lower]);
  const root1 = Math.sqrt(last - days[upper]);
  return [lower, upper, root0 === root1 ? 0 : (root0 - Math.sqrt(last - clamped)) / (root0 - root1)];
}

/** Profit at every grid price for one date and one volatility multiplier. */
export function sliceAt(cube: Cube, day: number, vol: number): Float64Array {
  const [v0, v1, wv] = bracket(cube.vols, vol);
  const [d0, d1, wd] = dayBracket(cube.days, day);
  const w00 = (1 - wv) * (1 - wd);
  const w01 = (1 - wv) * wd;
  const w10 = wv * (1 - wd);
  const w11 = wv * wd;
  const o00 = (v0 * cube.nD + d0) * cube.nP;
  const o01 = (v0 * cube.nD + d1) * cube.nP;
  const o10 = (v1 * cube.nD + d0) * cube.nP;
  const o11 = (v1 * cube.nD + d1) * cube.nP;
  const out = new Float64Array(cube.nP);
  const values = cube.values;
  for (let p = 0; p < cube.nP; p++) {
    out[p] = w00 * values[o00 + p] + w01 * values[o01 + p] + w10 * values[o10 + p] + w11 * values[o11 + p];
  }
  return out;
}

/** Read a slice at any price between its grid points. */
export function valueAt(prices: ArrayLike<number>, slice: ArrayLike<number>, price: number): number {
  const [lower, upper, weight] = bracket(prices, price);
  return slice[lower] * (1 - weight) + slice[upper] * weight;
}

/** Read a [vol][day] table, such as one of the Greeks, at any date and volatility. */
export function tableAt(cube: Cube, table: number[][], day: number, vol: number): number {
  const [v0, v1, wv] = bracket(cube.vols, vol);
  const [d0, d1, wd] = dayBracket(cube.days, day);
  const low = table[v0][d0] * (1 - wd) + table[v0][d1] * wd;
  const high = table[v1][d0] * (1 - wd) + table[v1][d1] * wd;
  return low * (1 - wv) + high * wv;
}

/** One number: profit at a price, date and volatility. Used by the tests. */
export function profitAt(cube: Cube, price: number, day: number, vol: number): number {
  return valueAt(cube.prices, sliceAt(cube, day, vol), price);
}
