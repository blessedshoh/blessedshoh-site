// The TypeScript grid reader must give the same answers as Grid.at in Python.
// The fixture is written by quant-core/scripts/export_grid_fixture.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bracket, profitAt, sliceAt, toCube } from "../src/lib/grid.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/grid-parity.json", import.meta.url), "utf8"));

for (const { name, grid, samples } of fixture.cases) {
  test(`${name}: every sample matches Grid.at in Python`, () => {
    const cube = toCube(grid);
    for (const [price, day, vol, expected] of samples) {
      const got = profitAt(cube, price, day, vol);
      const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
      assert.ok(Math.abs(got - expected) <= tolerance, `${name} at price ${price}, day ${day}, vol ${vol}: ${got} vs ${expected}`);
    }
  });
}

test("bracket finds the two surrounding points and the weight between them", () => {
  assert.deepEqual(bracket([0, 10, 20], 15), [1, 2, 0.5]);
  assert.deepEqual(bracket([0, 10, 20], 10), [1, 2, 0]);
  assert.deepEqual(bracket([0, 10, 20], -5), [0, 1, 0]);
  assert.deepEqual(bracket([0, 10, 20], 99), [1, 2, 1]);
  assert.deepEqual(bracket([7], 3), [0, 0, 0]);
});

test("a slice on a grid date and volatility is exactly that row of the grid", () => {
  const { grid } = fixture.cases[0];
  const cube = toCube(grid);
  const row = sliceAt(cube, cube.days[3], cube.vols[2]);
  const start = (2 * cube.nD + 3) * cube.nP;
  assert.deepEqual(Array.from(row), grid.profit.values.slice(start, start + cube.nP));
});
