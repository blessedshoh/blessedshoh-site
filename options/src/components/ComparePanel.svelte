<script lang="ts">
  // Compare mode: three strategies for one market view, priced by the API and
  // shown on one chart and one table, so the trade-offs are side by side.
  import { onMount, untrack } from "svelte";
  import { fetchGrid, fetchRisk } from "../lib/api.ts";
  import { candidates, OUTLOOKS, targetPrice, type Outlook } from "../lib/compare.ts";
  import { axisMoney, money, niceTicks, percent, price as formatPrice, signedMoney, strike as formatStrike } from "../lib/format.ts";
  import { sliceAt, toCube, valueAt } from "../lib/grid.ts";
  import { clonePosition } from "../lib/state.ts";
  import type { GridResponse, Leg, Position, RiskResponse } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    position: Position;
    onload: (legs: Leg[]) => void;
  }

  let { apiBase, position, onload }: Props = $props();

  const first = untrack(() => position.legs.find((leg) => leg.kind !== "stock"));
  let outlook = $state<Outlook>("rise");
  let movePct = $state(8);
  let days = $state(untrack(() => first?.days ?? 30));
  let volPct = $state(untrack(() => Math.round((first?.vol ?? 0.45) * 100)));
  let includeMine = $state(false);

  interface Row {
    name: string;
    idea: string;
    legs: Leg[];
    grid: GridResponse;
    risk: RiskResponse | null;
  }
  let rows = $state.raw<Row[]>([]);
  let busy = $state(false);
  let problem = $state("");

  const target = $derived(targetPrice(outlook, position.spot, movePct));
  const list = $derived(candidates(outlook, position.spot, movePct, volPct / 100, days));
  const requestKey = $derived(
    JSON.stringify([list, includeMine ? clonePosition(position) : null, position.spot, position.rate, position.div_yield]),
  );

  let live = false;
  let timer = 0;
  let controller: AbortController | null = null;
  let lastKey = "";

  $effect(() => {
    const key = requestKey;
    if (!live || key === lastKey) return;
    untrack(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(key), 300);
    });
  });

  async function load(key: string) {
    if (!(days > 0) || !(volPct > 0)) return;
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    const market = { label: "", spot: position.spot, rate: position.rate, div_yield: position.div_yield, exercise: position.exercise };
    const entries = list.map((c) => ({ name: c.name, idea: c.idea, position: { ...market, legs: c.legs } as Position }));
    if (includeMine) entries.push({ name: "Your position", idea: "What you have in the editor now.", position: clonePosition(position) });
    try {
      const results = await Promise.all(
        entries.map(async (entry) => {
          const [grid, risk] = await Promise.all([
            fetchGrid(apiBase, entry.position, 0.3, mine.signal),
            fetchRisk(apiBase, entry.position, 0.3, { drift: null, horizonDays: 0 }, mine.signal).catch(() => null),
          ]);
          return { name: entry.name, idea: entry.idea, legs: entry.position.legs, grid, risk } satisfies Row;
        }),
      );
      rows = results;
      lastKey = key;
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = "The strategies could not be priced.";
    } finally {
      if (mine === controller) busy = false;
    }
  }

  onMount(() => {
    live = true;
    load(requestKey);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  });

  // --- the chart --------------------------------------------------------------------

  const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
  const W = 760;
  const H = 320;
  const m = { l: 58, r: 14, t: 14, b: 28 };
  let width = $state(0);
  let svgEl: SVGSVGElement | undefined = $state();
  let hoverPrice = $state<number | null>(null);

  const series = $derived(
    rows.map((row, i) => {
      const cube = toCube(row.grid);
      const last = cube.days[cube.nD - 1];
      return { ...row, color: COLORS[i % COLORS.length], prices: cube.prices, expiry: sliceAt(cube, last, 1) };
    }),
  );
  const x0 = $derived(position.spot * 0.7);
  const x1 = $derived(position.spot * 1.3);
  const yDomain = $derived.by(() => {
    let lo = 0;
    let hi = 0;
    for (const s of series) {
      for (let i = 0; i < s.prices.length; i++) {
        if (s.prices[i] < x0 || s.prices[i] > x1) continue;
        lo = Math.min(lo, s.expiry[i]);
        hi = Math.max(hi, s.expiry[i]);
      }
    }
    if (hi - lo < 1) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  });
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + ((yDomain[1] - y) / (yDomain[1] - yDomain[0])) * (H - m.t - m.b);
  const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
  const xTicks = $derived(niceTicks(x0, x1, 7));
  const line = (prices: Float64Array, values: Float64Array) => {
    let d = "";
    for (let i = 0; i < prices.length; i++) {
      if (prices[i] < x0 || prices[i] > x1) continue;
      d += `${d ? "L" : "M"}${sx(prices[i]).toFixed(1)} ${sy(values[i]).toFixed(1)}`;
    }
    return d;
  };

  function onMove(event: PointerEvent) {
    const box = svgEl!.getBoundingClientRect();
    if (!(box.width > 0)) return;
    const px = ((event.clientX - box.left) * W) / box.width;
    hoverPrice = Math.min(x1, Math.max(x0, x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0)));
  }
  const hoverValues = $derived(
    hoverPrice == null ? [] : series.map((s) => ({ name: s.name, color: s.color, value: valueAt(s.prices, s.expiry, hoverPrice!) })),
  );

  // --- the table ----------------------------------------------------------------------

  const atTarget = (s: (typeof series)[number]) => valueAt(s.prices, s.expiry, target);
  const best = $derived.by(() => {
    if (!series.length) return { target: -1, chance: -1 };
    const targets = series.map(atTarget);
    const chances = series.map((s) => s.risk?.chance_of_profit ?? -1);
    return { target: targets.indexOf(Math.max(...targets)), chance: chances.indexOf(Math.max(...chances)) };
  });
  const breakevenText = (points: number[]) => (points.length ? points.map((p) => formatPrice(p)).join(" / ") : "None");
</script>

<section class="compare" aria-label="Compare strategies">
  <div class="head">
    <h2 class="section">Compare strategies</h2>
    <span class="status" aria-live="polite">{busy ? "Pricing" : problem}</span>
  </div>

  <div class="card">
    <div class="controls">
      <div class="ctl view">
        <span class="k">Your view: the price will</span>
        <span class="seg" role="group" aria-label="Your view">
          {#each OUTLOOKS as o (o.id)}
            <button type="button" aria-pressed={outlook === o.id} onclick={() => (outlook = o.id)}>{o.label}</button>
          {/each}
        </span>
      </div>
      <label class="ctl">
        <span class="ctop"><span class="k">{outlook === "range" ? "Range, either side" : "Size of move"}</span><span class="num">{movePct}%</span></span>
        <input type="range" min="2" max="30" step="1" bind:value={movePct} style="--fill: {((movePct - 2) / 28) * 100}%" />
      </label>
      <label class="ctl">
        <span class="k">Expiry (days)</span>
        <input class="field" type="number" min="1" max="1825" bind:value={days} />
      </label>
      <label class="ctl">
        <span class="k">Volatility %</span>
        <input class="field" type="number" min="1" max="500" bind:value={volPct} />
      </label>
    </div>
    <label class="mine"><input type="checkbox" bind:checked={includeMine} /> Include your current position</label>

    {#if series.length}
      <div class="chart" bind:clientWidth={width}>
        <svg
          bind:this={svgEl}
          viewBox="0 0 {W} {H}"
          role="group"
          aria-label="Profit at expiry for each strategy"
          onpointermove={onMove}
          onpointerleave={() => (hoverPrice = null)}
        >
          {#each yTicks as t (t)}
            <line class={t === 0 ? "zero" : "grid"} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text class="axis" x={m.l - 8} y={sy(t) + 4} text-anchor="end">{axisMoney(t)}</text>
          {/each}
          {#each xTicks as t (t)}
            <text class="axis" x={sx(t)} y={H - 8} text-anchor="middle">{formatStrike(t)}</text>
          {/each}
          <line class="spot" x1={sx(position.spot)} x2={sx(position.spot)} y1={m.t} y2={H - m.b} />
          {#if outlook !== "range" && outlook !== "move"}
            <line class="target" x1={sx(target)} x2={sx(target)} y1={m.t} y2={H - m.b} />
            {#if hoverPrice == null}
              <text class="tag" x={sx(target) + (outlook === "rise" ? 6 : -6)} y={m.t + 12} text-anchor={outlook === "rise" ? "start" : "end"}>
                Your target {formatPrice(target)}
              </text>
            {/if}
          {:else if outlook === "range"}
            <rect class="band" x={sx(position.spot * (1 - movePct / 100))} y={m.t} width={sx(position.spot * (1 + movePct / 100)) - sx(position.spot * (1 - movePct / 100))} height={H - m.t - m.b} />
          {:else}
            <line class="target" x1={sx(position.spot * (1 + movePct / 100))} x2={sx(position.spot * (1 + movePct / 100))} y1={m.t} y2={H - m.b} />
            <line class="target" x1={sx(position.spot * (1 - movePct / 100))} x2={sx(position.spot * (1 - movePct / 100))} y1={m.t} y2={H - m.b} />
          {/if}
          {#each series as s (s.name)}
            <path class="curve" d={line(s.prices, s.expiry)} style="stroke: {s.color}" />
          {/each}
          {#if hoverPrice != null}
            <line class="cross" x1={sx(hoverPrice)} x2={sx(hoverPrice)} y1={m.t} y2={H - m.b} />
            {#each hoverValues as h (h.name)}
              <circle cx={sx(hoverPrice)} cy={sy(h.value)} r="4" style="fill: {h.color}" />
            {/each}
          {/if}
        </svg>
        {#if hoverPrice != null}
          <div class="tip" style="left: {Math.min(Math.max(sx(hoverPrice) * (width / W), 110), width - 110)}px">
            <div class="tip-head">At expiry, price {formatPrice(hoverPrice)}</div>
            {#each hoverValues as h (h.name)}
              <div class="tip-row"><i style="background: {h.color}"></i>{h.name}<span>{signedMoney(h.value)}</span></div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="keys">
        {#each series as s (s.name)}<span><i style="background: {s.color}"></i>{s.name}</span>{/each}
        <span class="muted">Profit at expiry, one contract per leg</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              {#each series as s (s.name)}<th><i style="background: {s.color}"></i>{s.name}</th>{/each}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>The trade-off</th>
              {#each series as s (s.name)}<td class="idea">{s.idea}</td>{/each}
            </tr>
            <tr>
              <th>Cost today</th>
              {#each series as s (s.name)}
                <td class="num">{s.grid.summary.entry_cost >= 0 ? money(s.grid.summary.entry_cost) : `${money(-s.grid.summary.entry_cost)} credit`}</td>
              {/each}
            </tr>
            <tr>
              <th>{outlook === "rise" || outlook === "fall" ? `P/L if it hits ${formatPrice(target)}` : "P/L if unchanged"}</th>
              {#each series as s, i (s.name)}
                <td class="num" class:winner={i === best.target} class:pos={atTarget(s) > 0.5} class:neg={atTarget(s) < -0.5}>{signedMoney(atTarget(s))}</td>
              {/each}
            </tr>
            <tr>
              <th>Chance of profit</th>
              {#each series as s, i (s.name)}
                <td class="num" class:winner={i === best.chance}>{s.risk?.chance_of_profit != null ? percent(s.risk.chance_of_profit) : "—"}</td>
              {/each}
            </tr>
            <tr>
              <th>Max profit</th>
              {#each series as s (s.name)}<td class="num">{s.grid.summary.max_profit == null ? "Unlimited" : signedMoney(s.grid.summary.max_profit)}</td>{/each}
            </tr>
            <tr>
              <th>Max loss</th>
              {#each series as s (s.name)}
                <td class="num" class:neg={s.grid.summary.max_loss == null || s.grid.summary.max_loss < -0.5}>
                  {s.grid.summary.max_loss == null ? "Unlimited" : signedMoney(s.grid.summary.max_loss)}
                </td>
              {/each}
            </tr>
            <tr>
              <th>Break-even</th>
              {#each series as s (s.name)}<td class="num">{breakevenText(s.grid.summary.breakevens)}</td>{/each}
            </tr>
            <tr>
              <th>Legs</th>
              {#each series as s (s.name)}
                <td class="legs">
                  {#each s.legs as leg, j (j)}
                    <div>{leg.quantity > 0 ? "Buy" : "Sell"} {Math.abs(leg.quantity)} {leg.kind === "stock" ? "shares" : `${formatStrike(leg.strike!)} ${leg.kind}`}</div>
                  {/each}
                </td>
              {/each}
            </tr>
            <tr>
              <th></th>
              {#each series as s (s.name)}
                <td><button type="button" class="btn" onclick={() => onload(s.legs.map((leg) => ({ ...leg })))}>Load</button></td>
              {/each}
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">Highlighted: best result for your target, and the highest chance of profit (risk-neutral). One contract per leg, so costs differ; compare what each risks against what it can make.</p>
    {/if}
  </div>
</section>

<style>
  .compare {
    margin-top: 30px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .section {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .status {
    font: 400 12px var(--mono);
    color: var(--accent);
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px 18px;
  }
  .controls {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 110px 110px;
    gap: 16px;
    align-items: end;
  }
  .ctl {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .ctop {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .mine {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    font-size: 13.5px;
    color: var(--soft);
  }
  .chart {
    position: relative;
    margin-top: 12px;
  }
  .chart svg {
    display: block;
    width: 100%;
    height: auto;
    cursor: crosshair;
  }
  .grid {
    stroke: var(--grid);
  }
  .zero {
    stroke: var(--zero);
  }
  .axis,
  .tag {
    fill: var(--muted);
    font: 400 11px var(--mono);
  }
  .tag {
    fill: var(--soft);
  }
  .spot {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .target {
    stroke: var(--ink);
    stroke-dasharray: 5 4;
    opacity: 0.55;
  }
  .band {
    fill: var(--ink);
    opacity: 0.05;
  }
  .curve {
    fill: none;
    stroke-width: 2.2;
    stroke-linejoin: round;
  }
  .cross {
    stroke: var(--muted);
  }
  .tip {
    position: absolute;
    top: 18px;
    transform: translateX(-50%);
    pointer-events: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 8px 10px;
    font: 400 12px/1.6 var(--mono);
    min-width: 200px;
  }
  .tip-head {
    color: var(--muted);
    margin-bottom: 2px;
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tip-row span {
    margin-left: auto;
    color: var(--ink);
  }
  i {
    display: inline-block;
    width: 12px;
    height: 3px;
    border-radius: 2px;
    vertical-align: middle;
    margin-right: 7px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 6px 0 14px;
    font: 400 12px var(--mono);
    color: var(--soft);
  }
  .muted {
    margin-left: auto;
    color: var(--muted);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    min-width: 560px;
  }
  th,
  td {
    text-align: left;
    padding: 9px 10px;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  thead th {
    border-top: 0;
    font: 500 13px var(--sans);
    color: var(--ink);
  }
  tbody th {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  td.num {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  td.idea {
    color: var(--soft);
    font-size: 13px;
    line-height: 1.45;
  }
  td.legs {
    font: 400 12px/1.6 var(--mono);
    color: var(--soft);
  }
  td.winner {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    font-weight: 500;
  }
  .note {
    margin: 10px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  @media (max-width: 860px) {
    .controls {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .view {
      grid-column: 1 / -1;
    }
    .view .seg {
      flex-wrap: wrap;
    }
  }
</style>
