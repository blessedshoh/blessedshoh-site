<script lang="ts">
  // Draw a payoff, get the portfolio. The drawing is per share at expiry; the
  // Python API finds the listed options, stock and cash that build it.
  import { onMount, untrack } from "svelte";
  import { fetchReplicate, type ReplicateResponse } from "../lib/api.ts";
  import { money, price as formatPrice, strike as formatStrike } from "../lib/format.ts";
  import { snap, strikeStep } from "../lib/templates.ts";
  import type { Leg, Position } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    position: Position;
    onload: (legs: Leg[]) => void;
  }

  let { apiBase, position, onload }: Props = $props();

  const BINS = 49;
  const start = untrack(() => ({
    spot: position.spot,
    leg: position.legs.find((leg) => leg.kind !== "stock"),
  }));
  let days = $state(start.leg?.days ?? 30);
  let volPct = $state(Math.round((start.leg?.vol ?? 0.45) * 100));
  let mode = $state<"match" | "cheapest">("match");
  let maxLegs = $state(6);

  const spot = $derived(position.spot);
  const x0 = $derived(spot * 0.75);
  const x1 = $derived(spot * 1.25);
  const yMax = $derived(Math.max(1, Math.round(spot * 0.2)));
  const step = $derived(strikeStep(spot));
  const strikes = $derived(listedStrikes(spot));
  // The drawing grid: evenly spaced points plus every listed strike, so a bend drawn
  // on a strike stays exactly on it (and can then be built exactly).
  const xs = $derived(drawingGrid(spot));

  function listedStrikes(s: number): number[] {
    const st = strikeStep(s);
    const out: number[] = [];
    for (let k = Math.ceil((s * 0.75) / st) * st; k <= s * 1.25 + 1e-9; k += st) out.push(Number(k.toFixed(4)));
    return out;
  }

  function drawingGrid(s: number): number[] {
    const lo = s * 0.75;
    const hi = s * 1.25;
    const even = Array.from({ length: BINS }, (_, i) => lo + ((hi - lo) * i) / (BINS - 1));
    const merged = [...even, ...listedStrikes(s)].sort((a, b) => a - b);
    return merged.filter((x, i) => i === 0 || x - merged[i - 1] > (hi - lo) * 1e-4);
  }

  // The drawing: payoff per share at each bin. Starts as a tent around the price.
  let ys = $state<number[]>(untrack(() => preset("tent")));
  let result = $state.raw<ReplicateResponse | null>(null);
  let busy = $state(false);
  let problem = $state("");
  let note = $state("");

  function preset(name: "tent" | "vee" | "step" | "capped" | "flat"): number[] {
    const s = untrack(() => position.spot);
    const st = strikeStep(s);
    const at = (offset: number) => snap(s * (1 + offset), st);
    const height = Math.round(s * 0.06);
    return drawingGrid(s).map((x) => {
      switch (name) {
        case "tent": {
          const a = at(-0.06), m = at(0), b = at(0.06);
          return x <= a || x >= b ? 0 : x <= m ? (height * (x - a)) / (m - a) : (height * (b - x)) / (b - m);
        }
        case "vee": {
          const m = at(0);
          return Math.min(Math.abs(x - m) - height / 2, s * 0.15);
        }
        case "step": {
          const a = at(0.03), b = at(0.06);
          return x <= a ? 0 : x >= b ? height : (height * (x - a)) / (b - a);
        }
        case "capped": {
          const a = at(-0.03), b = at(0.09);
          return Math.min(Math.max(x - a, 0), b - a) - height / 3;
        }
        default:
          return 0;
      }
    });
  }

  function usePreset(name: Parameters<typeof preset>[0]) {
    ys = preset(name);
    solveSoon(0);
  }

  // --- drawing --------------------------------------------------------------------

  const W = 720;
  const H = 300;
  const m = { l: 48, r: 14, t: 14, b: 28 };
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + ((yMax - y) / (2 * yMax)) * (H - m.t - m.b);
  let svgEl: SVGSVGElement | undefined = $state();
  let drawing = false;
  let lastBin = -1;

  function pointToBin(event: PointerEvent): { bin: number; value: number } | null {
    const box = svgEl!.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return null; // not laid out: never write a bad value
    const px = ((event.clientX - box.left) * W) / box.width;
    const py = ((event.clientY - box.top) * H) / box.height;
    const price = x0 + Math.min(Math.max((px - m.l) / (W - m.l - m.r), 0), 1) * (x1 - x0);
    const value = yMax - ((py - m.t) / (H - m.t - m.b)) * 2 * yMax;
    let bin = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - price) < Math.abs(xs[bin] - price)) bin = i;
    return { bin, value: Math.max(-yMax, Math.min(yMax, value)) };
  }

  function paint(event: PointerEvent) {
    const point = pointToBin(event);
    if (!point || !Number.isFinite(point.value)) return;
    const { bin, value } = point;
    const next = [...ys];
    if (lastBin >= 0 && Math.abs(bin - lastBin) > 1) {
      // Fill the points a fast stroke skipped, in a straight line by price.
      const from = next[lastBin];
      const direction = Math.sign(bin - lastBin);
      for (let j = lastBin + direction; j !== bin; j += direction) {
        next[j] = from + ((value - from) * (xs[j] - xs[lastBin])) / (xs[bin] - xs[lastBin]);
      }
    }
    next[bin] = value;
    ys = next;
    lastBin = bin;
  }

  function down(event: PointerEvent) {
    event.preventDefault();
    drawing = true;
    lastBin = -1;
    try {
      svgEl?.setPointerCapture(event.pointerId);
    } catch {
      // Some pointers can't be captured; drawing still works while the pointer stays on the pad.
    }
    paint(event);
  }
  function move(event: PointerEvent) {
    if (drawing) paint(event);
  }
  function up() {
    if (!drawing) return;
    drawing = false;
    solveSoon(0);
  }

  const path = (values: number[], prices: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${sx(prices[i]).toFixed(1)} ${sy(Math.max(-yMax, Math.min(yMax, v))).toFixed(1)}`).join("");

  // --- solving --------------------------------------------------------------------

  let timer = 0;
  let controller: AbortController | null = null;
  const settingsKey = $derived(JSON.stringify([days, volPct, mode, maxLegs, position.spot, position.rate, position.div_yield]));
  let live = false;
  let lastKey = "";

  $effect(() => {
    const key = settingsKey;
    if (!live || key === lastKey) return;
    lastKey = key;
    untrack(() => solveSoon(300));
  });

  function solveSoon(delay: number) {
    window.clearTimeout(timer);
    timer = window.setTimeout(solve, delay);
  }

  async function solve() {
    if (!(days > 0) || !(volPct > 0)) return;
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    try {
      result = await fetchReplicate(
        apiBase,
        {
          spot: position.spot,
          days,
          rate: position.rate,
          div_yield: position.div_yield,
          atm_vol: volPct / 100,
          target_prices: xs,
          target_payoffs: ys.map((y) => (Number.isFinite(y) ? Math.round(y * 100) / 100 : 0)),
          mode,
          max_legs: maxLegs,
        },
        mine.signal,
      );
      problem = "";
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem = (error as Error).message || "No portfolio found.";
    } finally {
      if (mine === controller) busy = false;
    }
  }

  onMount(() => {
    live = true;
    lastKey = settingsKey;
    solve();
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  });

  // --- loading into the tool ------------------------------------------------------------

  // Positions smaller than half a hundredth of a contract are solver dust, not advice.
  const shown = $derived(result?.holdings.filter((h) => Math.abs(h.quantity) >= 0.005) ?? []);
  const positions = $derived(shown.filter((h) => h.kind !== "cash"));
  const cash = $derived(shown.filter((h) => h.kind === "cash").reduce((sum, h) => sum + h.quantity, 0));
  const describe = (h: ReplicateResponse["holdings"][number]) => {
    const amount = Math.abs(h.quantity);
    const n = Math.abs(amount - Math.round(amount)) < 0.005 ? String(Math.round(amount)) : amount.toFixed(2);
    if (h.kind === "cash") return `${h.quantity > 0 ? "Receive" : "Pay"} ${money(amount, 2)} at expiry`;
    const verb = h.quantity > 0 ? "Buy" : "Sell";
    if (h.kind === "stock") return `${verb} ${n} share${n === "1" ? "" : "s"}`;
    return `${verb} ${n} × ${formatStrike(h.strike!)} ${h.kind} at ${formatPrice(h.price)}`;
  };

  function load() {
    if (!result || positions.length === 0 || positions.length > 8) return;
    const carry = Math.exp((-position.div_yield * days) / 365);
    const legs: Leg[] = positions.map((h) =>
      h.kind === "stock"
        ? { kind: "stock", quantity: Math.round(h.quantity * carry * 100 * 100) / 100, entry_price: position.spot }
        : {
            kind: h.kind as "call" | "put",
            quantity: Math.round(h.quantity * 100) / 100,
            strike: h.strike!,
            days,
            vol: volPct / 100,
            entry_price: h.price,
          },
    );
    onload(legs.filter((leg) => leg.quantity !== 0));
    note =
      Math.abs(cash) > 0.005
        ? `Loaded, one contract per unit. The portfolio also ${cash > 0 ? "receives" : "pays"} ${money(Math.abs(cash) * 100, 2)} in cash at expiry, which the tool's chart leaves out, so the chart is shifted by that amount.`
        : "Loaded at model prices, one contract per unit.";
  }
</script>

<section class="sketch" aria-label="Draw a payoff">
  <div class="head">
    <h2 class="section">Draw a payoff</h2>
    <span class="status" aria-live="polite">{busy ? "Solving" : problem}</span>
  </div>

  <div class="card">
    <p class="intro">
      Drag across the chart to draw what you want to be paid at expiry, per share. The engine finds the listed options,
      stock and cash that build it. Bends on the faint strike lines can be built exactly; anywhere else it gets as close as
      it can.
    </p>

    <div class="presets">
      <button type="button" class="btn" onclick={() => usePreset("tent")}>Range-bound</button>
      <button type="button" class="btn" onclick={() => usePreset("vee")}>Big move</button>
      <button type="button" class="btn" onclick={() => usePreset("step")}>Step up</button>
      <button type="button" class="btn" onclick={() => usePreset("capped")}>Capped upside</button>
      <button type="button" class="btn" onclick={() => usePreset("flat")}>Clear</button>
    </div>

    <svg
      bind:this={svgEl}
      class="pad"
      viewBox="0 0 {W} {H}"
      role="img"
      aria-label="Drawing area for a payoff at expiry"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      {#each strikes as k (k)}
        <line class="strike" x1={sx(k)} x2={sx(k)} y1={m.t} y2={H - m.b} />
      {/each}
      {#each [-yMax, -yMax / 2, 0, yMax / 2, yMax] as v (v)}
        <line class={v === 0 ? "zero" : "grid"} x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} />
        <text class="axis" x={m.l - 6} y={sy(v) + 4} text-anchor="end">{v === 0 ? "$0" : `${v > 0 ? "+" : "−"}$${Math.abs(Math.round(v))}`}</text>
      {/each}
      {#each strikes.filter((_, i) => i % 2 === 0) as k (k)}
        <text class="axis" x={sx(k)} y={H - 8} text-anchor="middle">{formatStrike(k)}</text>
      {/each}
      <line class="spot" x1={sx(spot)} x2={sx(spot)} y1={m.t} y2={H - m.b} />
      <path class="target" d={path(ys, xs)} />
      {#if result}
        <path class="fitted" d={path(result.fitted, result.prices)} />
      {/if}
    </svg>
    <div class="keys">
      <span><i class="sw target-sw"></i>Your drawing</span>
      <span><i class="sw fitted-sw"></i>What the portfolio pays</span>
      <span class="muted">Price at expiry &rarr;</span>
    </div>

    <div class="controls">
      <div class="ctl">
        <span class="k">Goal</span>
        <span class="seg" role="group" aria-label="What to optimise">
          <button type="button" aria-pressed={mode === "match"} onclick={() => (mode = "match")}>Closest match</button>
          <button type="button" aria-pressed={mode === "cheapest"} onclick={() => (mode = "cheapest")}>Never worse, cheapest</button>
        </span>
      </div>
      <label class="ctl">
        <span class="ctop"><span class="k">Most legs</span><span class="num">{maxLegs}</span></span>
        <input type="range" min="1" max="8" step="1" bind:value={maxLegs} style="--fill: {((maxLegs - 1) / 7) * 100}%" />
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

    {#if result}
      <div class="answer">
        <dl class="facts">
          <div><dt class="k">{result.cost >= 0 ? "Costs today" : "Pays you today"}</dt><dd class="num">{money(Math.abs(result.cost) * 100, 0)} a contract</dd></div>
          <div><dt class="k">Largest gap from your drawing</dt><dd class="num">{money(result.max_error, 2)} a share</dd></div>
          <div><dt class="k">Positions</dt><dd class="num">{positions.length}</dd></div>
        </dl>
        <ul class="holdings">
          {#each shown as h, i (i)}<li>{describe(h)}</li>{/each}
        </ul>
        <button type="button" class="btn solid" onclick={load} disabled={positions.length === 0}>Load into the tool</button>
        {#if note}<p class="note">{note}</p>{/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .sketch {
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
  .intro {
    margin: 0 0 12px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--soft);
    max-width: 80ch;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .pad {
    display: block;
    width: 100%;
    height: auto;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .strike {
    stroke: var(--grid);
    stroke-dasharray: 1 3;
  }
  .grid {
    stroke: var(--grid);
  }
  .zero {
    stroke: var(--zero);
  }
  .spot {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .axis {
    fill: var(--muted);
    font: 400 11px var(--mono);
  }
  .target {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    stroke-linejoin: round;
  }
  .fitted {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }
  .keys {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    margin: 4px 0 14px;
    font: 400 12px var(--mono);
    color: var(--soft);
  }
  .muted {
    margin-left: auto;
    color: var(--muted);
  }
  .sw {
    display: inline-block;
    width: 18px;
    height: 0;
    vertical-align: middle;
    margin-right: 7px;
  }
  .target-sw {
    border-top: 2px dashed var(--ink);
  }
  .fitted-sw {
    border-top: 2.5px solid var(--accent);
  }
  .controls {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 120px 120px;
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
  .answer {
    margin-top: 16px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    margin: 0;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .facts div {
    background: var(--panel);
    padding: 9px 12px;
  }
  dt,
  dd {
    margin: 0;
  }
  dd {
    font-size: 16px;
    margin-top: 2px;
  }
  .holdings {
    margin: 12px 0;
    padding-left: 18px;
    font: 400 13px/1.7 var(--mono);
    color: var(--soft);
  }
  .note {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--accent);
  }
  @media (max-width: 860px) {
    .controls {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .controls .ctl:first-child {
      grid-column: 1 / -1;
    }
    .facts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
