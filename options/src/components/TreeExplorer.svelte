<script lang="ts">
  // The binomial explorer: a small tree drawn node by node, and how tree prices
  // converge as the number of steps grows. All values come from the Python API.
  import { onMount, untrack } from "svelte";
  import { fetchConvergence, fetchTree, type SingleOption } from "../lib/api.ts";
  import { money, price as formatPrice, strike as formatStrike } from "../lib/format.ts";
  import type { ConvergenceResponse, Position, TreeResponse } from "../lib/types.ts";

  interface Props {
    apiBase: string;
    /** The position the chart currently shows; its option legs can be explored. */
    position: Position;
  }

  let { apiBase, position }: Props = $props();

  const options = $derived(position.legs.map((leg, index) => ({ leg, index })).filter(({ leg }) => leg.kind !== "stock"));
  let chosen = $state(0);
  let steps = $state(5);
  let american = $state(true);
  let tree = $state.raw<TreeResponse | null>(null);
  let series = $state.raw<ConvergenceResponse | null>(null);
  let busy = $state(false);
  let failed = $state(false);

  const pick = $derived(options.find((item) => item.index === chosen) ?? options[0] ?? null);
  const option = $derived<SingleOption | null>(
    pick
      ? {
          spot: position.spot,
          strike: pick.leg.strike!,
          days: pick.leg.days!,
          vol: pick.leg.vol!,
          rate: position.rate,
          div_yield: position.div_yield,
          kind: pick.leg.kind as "call" | "put",
          american,
        }
      : null,
  );
  const optionKey = $derived(JSON.stringify(option));
  const treeKey = $derived(JSON.stringify([option, steps]));

  let live = false;
  let lastTree = "";
  let lastSeries = "";
  let timer = 0;
  let controller: AbortController | null = null;

  $effect(() => {
    const keys = [treeKey, optionKey];
    if (!live) return;
    untrack(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(keys[0], keys[1]), 200);
    });
  });

  async function load(treeK: string, seriesK: string) {
    if (!option || option.days <= 0) return;
    controller?.abort();
    const mine = (controller = new AbortController());
    busy = true;
    try {
      const wantSeries = seriesK !== lastSeries;
      const [t, s] = await Promise.all([
        treeK !== lastTree ? fetchTree(apiBase, option, steps, mine.signal) : Promise.resolve(tree),
        wantSeries ? fetchConvergence(apiBase, option, mine.signal) : Promise.resolve(series),
      ]);
      tree = t;
      series = s;
      lastTree = treeK;
      lastSeries = seriesK;
      failed = false;
    } catch (error) {
      if ((error as Error).name !== "AbortError") failed = true;
    } finally {
      if (mine === controller) busy = false;
    }
  }

  onMount(() => {
    live = true;
    if (options.length) chosen = options[0].index;
    load(treeKey, optionKey);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  });

  // --- drawing the tree ---------------------------------------------------------

  const TW = 760;
  const NODE_W = 64;
  const NODE_H = 30;
  const n = $derived(tree ? tree.prices.length - 1 : 0);
  const gap = $derived(Math.max(34, Math.min(46, 320 / Math.max(n, 1))));
  const TH = $derived(Math.max(140, n * gap + NODE_H + 24));
  const colX = (i: number) => NODE_W / 2 + 8 + (i * (TW - NODE_W - 16)) / Math.max(n, 1);
  const rowY = (i: number, j: number) => TH / 2 + (i / 2 - j) * gap;
  const earlyCount = $derived(tree ? tree.exercise.slice(0, -1).flat().filter(Boolean).length : 0);
  const premium = $derived(tree ? tree.american_value - tree.european_value : 0);

  // --- the convergence chart ------------------------------------------------------

  const CW = 760;
  const CH = 220;
  const cm = { left: 56, right: 14, top: 14, bottom: 30 };
  // Zoom on where the trees settle (step 8 onwards). The first few CRR steps swing
  // far off the answer; they run off the chart rather than flatten everything else.
  const yRange = $derived.by(() => {
    if (!series) return [0, 1];
    const target = series.reference;
    const settled = [...series.crr.slice(7), ...series.leisen_reimer.slice(7), series.black_scholes];
    const half = Math.max(...settled.map((v) => Math.abs(v - target)), 0.002 * Math.abs(target), 0.005) * 1.3;
    return [target - half, target + half];
  });
  const cx = (step: number) => cm.left + ((step - 1) / 99) * (CW - cm.left - cm.right);
  const cy = (value: number) => {
    const [lo, hi] = yRange;
    return cm.top + ((hi - value) / (hi - lo)) * (CH - cm.top - cm.bottom);
  };
  const inView = (value: number) => value >= yRange[0] && value <= yRange[1];
  /** A path that lifts the pen over points outside the chart instead of squashing them onto its edge. */
  const line = (values: number[]) => {
    let d = "";
    let drawing = false;
    values.forEach((v, i) => {
      if (!inView(v)) {
        drawing = false;
        return;
      }
      d += `${drawing ? "L" : "M"}${cx(i + 1).toFixed(1)} ${cy(v).toFixed(1)}`;
      drawing = true;
    });
    return d;
  };
  const showEuropean = $derived(
    !!series && american && inView(series.black_scholes) && Math.abs(series.black_scholes - series.reference) > 1e-4,
  );
</script>

<section class="explorer" aria-label="Binomial tree explorer">
  <div class="head">
    <h2 class="section">How the tree prices it</h2>
    <span class="status" aria-live="polite">{busy ? "Building" : failed ? "Not updated" : ""}</span>
  </div>

  {#if !pick}
    <p class="note card">This position has no options to explore.</p>
  {:else}
    <div class="card">
      <div class="controls">
        <label class="ctl">
          <span class="k">Option</span>
          <select class="field" bind:value={chosen}>
            {#each options as { leg, index } (index)}
              <option value={index}>{leg.kind === "call" ? "Call" : "Put"} {formatStrike(leg.strike!)} · {leg.days} days</option>
            {/each}
          </select>
        </label>
        <div class="ctl">
          <span class="k">Exercise</span>
          <span class="seg" role="group" aria-label="Exercise style in the explorer">
            <button type="button" aria-pressed={!american} onclick={() => (american = false)}>European</button>
            <button type="button" aria-pressed={american} onclick={() => (american = true)}>American</button>
          </span>
        </div>
        <label class="ctl steps">
          <span class="ctop"><span class="k">Steps</span><span class="num">{steps}</span></span>
          <input type="range" min="1" max="8" step="1" bind:value={steps} style="--fill: {((steps - 1) / 7) * 100}%" />
        </label>
      </div>

      {#if tree}
        <div class="figure" class:busy>
          <svg viewBox="0 0 {TW} {TH}" role="img" aria-label="Binomial tree with {n} steps">
            {#each tree.prices as row, i (i)}
              {#if i < n}
                {#each row as _, j (j)}
                  <line class="edge" x1={colX(i)} y1={rowY(i, j)} x2={colX(i + 1)} y2={rowY(i + 1, j + 1)} />
                  <line class="edge" x1={colX(i)} y1={rowY(i, j)} x2={colX(i + 1)} y2={rowY(i + 1, j)} />
                {/each}
              {/if}
            {/each}
            {#each tree.prices as row, i (i)}
              {#each row as stock, j (j)}
                {@const early = i < n && tree.exercise[i][j]}
                {@const paid = i === n && tree.values[i][j] > 0}
                <g class="node" class:early class:paid transform="translate({colX(i)} {rowY(i, j)})">
                  <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx="3" />
                  <text class="px" y="-3" text-anchor="middle">{formatPrice(stock)}</text>
                  <text class="val" y="10" text-anchor="middle">{formatPrice(tree.values[i][j])}</text>
                </g>
              {/each}
            {/each}
          </svg>
        </div>

        <p class="legend-note">
          Each node shows the <b>price</b> above the <b>option's value</b>. Each step is {tree.dt_days.toFixed(1)} days; the
          price moves up &times;{tree.u.toFixed(4)} or down &times;{tree.d.toFixed(4)}, and the risk-neutral chance of an up
          move is {(tree.p * 100).toFixed(1)}%.
          {#if american}
            {#if earlyCount > 0}
              <span class="amber">Amber nodes</span> are where exercising early beats holding on.
            {:else}
              No node is worth exercising early here.
              {#if pick.leg.kind === "call" && position.div_yield === 0}
                With no dividends an American call is never exercised early, so it is worth exactly the European price.
                Add a dividend yield above to see it change.
              {/if}
            {/if}
          {/if}
        </p>

        <dl class="facts">
          <div><dt class="k">This {n}-step tree</dt><dd class="num">{money(tree.values[0][0], 2)}</dd></div>
          <div><dt class="k">European (Black-Scholes)</dt><dd class="num">{money(tree.european_value, 2)}</dd></div>
          <div><dt class="k">American (201 steps)</dt><dd class="num">{money(tree.american_value, 2)}</dd></div>
          <div>
            <dt class="k">Early-exercise premium</dt>
            <dd class="num" class:pos={premium > 0.005}>{money(Math.max(premium, 0), 2)}</dd>
          </div>
        </dl>
      {/if}
    </div>

    {#if series}
      <div class="card conv">
        <div class="k">Convergence</div>
        <p class="note">
          As the tree gets more steps, its price approaches the true value. The textbook Cox-Ross-Rubinstein tree zig-zags
          its way there; Leisen-Reimer matches the bell curve directly and gets close in a few dozen steps.
        </p>
        <svg viewBox="0 0 {CW} {CH}" role="img" aria-label="Tree price by number of steps">
          <line class="axis-line" x1={cm.left} x2={CW - cm.right} y1={CH - cm.bottom} y2={CH - cm.bottom} />
          {#each [1, 25, 50, 75, 100] as step (step)}
            <text class="axis" x={cx(step)} y={CH - 10} text-anchor="middle">{step}</text>
          {/each}
          {#each [yRange[0], series.reference, yRange[1]] as v, i (i)}
            <text class="axis" x={cm.left - 8} y={cy(v) + 4} text-anchor="end">{formatPrice(v)}</text>
          {/each}
          <line class="target" x1={cm.left} x2={CW - cm.right} y1={cy(series.reference)} y2={cy(series.reference)} />
          {#if showEuropean}
            {@const below = series.black_scholes < series.reference}
            <line class="bs" x1={cm.left} x2={CW - cm.right} y1={cy(series.black_scholes)} y2={cy(series.black_scholes)} />
            <text class="tag" x={CW - cm.right - 4} y={cy(series.black_scholes) + (below ? 14 : -5)} text-anchor="end"
              >European (Black-Scholes) {formatPrice(series.black_scholes)}</text
            >
          {/if}
          <text
            class="tag"
            x={CW - cm.right - 4}
            y={cy(series.reference) + (showEuropean && series.black_scholes > series.reference ? 14 : -5)}
            text-anchor="end">True value {formatPrice(series.reference)}</text
          >
          <path class="crr" d={line(series.crr)} />
          <path class="lr" d={line(series.leisen_reimer)} />
        </svg>
        <div class="keys">
          <span><i class="sw crr-sw"></i>Cox-Ross-Rubinstein</span>
          <span><i class="sw lr-sw"></i>Leisen-Reimer</span>
          <span class="axis-label">Steps in the tree</span>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .explorer {
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
    min-width: 0;
  }
  .conv {
    margin-top: 14px;
  }
  .note {
    margin: 4px 0 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--muted);
  }
  .controls {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) auto minmax(0, 1fr);
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
  .figure {
    margin-top: 14px;
    overflow-x: auto;
    transition: opacity 0.2s;
  }
  .figure.busy {
    opacity: 0.55;
  }
  .figure svg {
    display: block;
    width: 100%;
    min-width: 560px;
    height: auto;
  }
  .edge {
    stroke: var(--line);
  }
  .node rect {
    fill: var(--panel);
    stroke: var(--line);
  }
  .node text {
    font: 500 10.5px var(--mono);
  }
  .node .px {
    fill: var(--muted);
  }
  .node .val {
    fill: var(--ink);
  }
  .node.paid rect {
    stroke: var(--profit);
  }
  .node.early rect {
    fill: color-mix(in srgb, var(--accent) 22%, var(--panel));
    stroke: var(--accent);
  }
  .legend-note {
    margin: 12px 0 0;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--soft);
  }
  .legend-note b {
    font-weight: 500;
    color: var(--ink);
  }
  .amber {
    color: var(--accent);
    font-weight: 500;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin: 14px 0 0;
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
  .conv svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .axis,
  .tag {
    fill: var(--muted);
    font: 400 11px var(--mono);
  }
  .tag {
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
  }
  .axis-line {
    stroke: var(--line);
  }
  .target {
    stroke: var(--ink);
    stroke-dasharray: 4 4;
    opacity: 0.6;
  }
  .bs {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .crr,
  .lr {
    fill: none;
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .crr {
    stroke: var(--muted);
  }
  .lr {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .keys {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    margin-top: 6px;
    font: 400 12px var(--mono);
    color: var(--soft);
  }
  .sw {
    display: inline-block;
    width: 18px;
    height: 2px;
    vertical-align: middle;
    margin-right: 7px;
  }
  .crr-sw {
    background: var(--muted);
  }
  .lr-sw {
    background: var(--accent);
  }
  .axis-label {
    margin-left: auto;
    color: var(--muted);
  }

  @media (max-width: 760px) {
    .controls {
      grid-template-columns: minmax(0, 1fr);
    }
    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
