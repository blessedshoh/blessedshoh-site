<script lang="ts">
  // The profit chart. Everything is drawn directly as SVG: no chart library.
  // It receives ready-made series (profit at each grid price) and only draws them.
  import { axisMoney, niceTicks, price as formatPrice, signedMoney, strike as formatStrike } from "../lib/format.ts";
  import { bracket } from "../lib/grid.ts";
  import { snap } from "../lib/templates.ts";
  import type { Leg } from "../lib/types.ts";

  interface Props {
    prices: Float64Array;
    /** Profit on the selected date at the selected volatility. */
    curve: Float64Array;
    /** Profit at the first expiry. */
    expiry: Float64Array;
    /** Profit today at the selected volatility. Only used to keep the vertical scale steady. */
    today: Float64Array;
    spot: number;
    breakevens: number[];
    /** The legs as they are being edited, so strike handles follow the pointer. */
    legs: Leg[];
    label: string;
    /** Short name of the selected date for the hover readout: "today", "in 12 days" or "expiry". */
    curveName: string;
    atExpiry: boolean;
    /** Status text shown beside the legend, empty when idle. */
    busy: string;
    stale: boolean;
    /** Strike spacing used while dragging. */
    step: number;
    onstrike?: (indices: number[], strike: number) => void;
    /** Risk-neutral density of the price at expiry, drawn as the "likely range" overlay. */
    density?: { prices: number[]; density: number[] } | null;
    /** Profit the day after earnings, at the selected volatility; null without an announcement on the chart. */
    eventCurve?: Float64Array | null;
  }

  let {
    prices,
    curve,
    expiry,
    today,
    spot,
    breakevens,
    legs,
    label,
    curveName,
    atExpiry,
    eventCurve = null,
    busy,
    stale,
    step,
    onstrike,
    density = null,
  }: Props = $props();

  let showDensity = $state(true);

  const uid = $props.id();
  const margin = { left: 58, right: 16, top: 16 };
  /** Height of one row of strike handles under the plot. */
  const ROW = 22;

  let width = $state(0);
  let svgElement: SVGSVGElement | undefined = $state();
  let hoverPrice = $state<number | null>(null);
  /** Key of the strike handle being dragged. */
  let dragging = $state<string | null>(null);

  // Before the page is live there is no measured width, so the server draws at a typical size.
  const W = $derived(width > 0 ? Math.max(300, Math.floor(width)) : 880);
  const x0 = $derived(prices[0]);
  const x1 = $derived(prices[prices.length - 1]);
  const sx = (value: number) => margin.left + ((value - x0) / (x1 - x0)) * (W - margin.left - margin.right);
  const px = (value: number) => value.toFixed(1);

  // One handle per distinct strike. Legs that share a strike move together.
  const handles = $derived.by(() => {
    const groups = new Map<number, number[]>();
    legs.forEach((leg, index) => {
      if (leg.kind === "stock" || leg.strike == null || !Number.isFinite(leg.strike)) return;
      groups.set(leg.strike, [...(groups.get(leg.strike) ?? []), index]);
    });
    return [...groups.entries()]
      .filter(([strike]) => strike >= x0 && strike <= x1)
      .map(([strike, indices]) => {
        const kinds = [...new Set(indices.map((index) => (legs[index].kind === "call" ? "C" : "P")))].join("/");
        const text = `${formatStrike(strike)} ${kinds}`;
        return { strike, indices, text, key: indices.join("-"), half: (text.length * 6.8 + 14) / 2 };
      });
  });

  // Handles that would overlap drop to a second (or third) row, and the chart grows to fit.
  const placed = $derived.by(() => {
    const ends: number[] = [];
    return handles
      .map((handle) => {
        const x = sx(handle.strike);
        const centre = Math.min(Math.max(x, handle.half + 2), W - handle.half - 2);
        return { ...handle, x, dx: centre - x, centre };
      })
      .sort((a, b) => a.centre - b.centre)
      .map((handle) => {
        let row = ends.findIndex((end) => handle.centre - handle.half > end + 4);
        if (row === -1) row = ends.length;
        ends[row] = handle.centre + handle.half;
        return { ...handle, row };
      });
  });
  const rows = $derived(placed.reduce((most, handle) => Math.max(most, handle.row + 1), 1));
  const bottom = $derived(50 + (rows - 1) * ROW);
  const H = $derived(Math.round(Math.max(260, Math.min(430, W * 0.46))) + (rows - 1) * ROW);

  // The vertical scale covers today, the selected date and expiry, so it holds
  // still while the date slider moves.
  const yDomain = $derived.by(() => {
    let low = 0;
    let high = 0;
    for (const series of eventCurve ? [curve, expiry, today, eventCurve] : [curve, expiry, today]) {
      for (let i = 0; i < series.length; i++) {
        if (series[i] < low) low = series[i];
        if (series[i] > high) high = series[i];
      }
    }
    if (high - low < 1) {
      low -= 1;
      high += 1;
    }
    const pad = (high - low) * 0.09;
    return [low - pad, high + pad];
  });

  const sy = (value: number) =>
    margin.top + ((yDomain[1] - value) / (yDomain[1] - yDomain[0])) * (H - margin.top - bottom);

  const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
  const xTicks = $derived(niceTicks(x0, x1, W < 560 ? 5 : 8));
  // An axis label at the same price as a strike would only repeat the handle's number, so it is left out.
  const visibleXTicks = $derived(
    xTicks.filter((tick) => handles.every((handle) => Math.abs(sx(tick) - sx(handle.strike)) > 12)),
  );
  const zeroY = $derived(sy(0));

  function linePath(series: Float64Array): string {
    let d = "";
    for (let i = 0; i < prices.length; i++) d += `${i ? "L" : "M"}${px(sx(prices[i]))} ${px(sy(series[i]))}`;
    return d;
  }

  // The likely-range overlay: the density scaled into the bottom quarter of the plot.
  const densityPath = $derived.by(() => {
    if (!density || !density.prices.length) return "";
    const peak = Math.max(...density.density);
    if (!(peak > 0)) return "";
    const base = H - bottom;
    const band = (H - margin.top - bottom) * 0.2;
    let d = `M${px(sx(density.prices[0]))} ${px(base)}`;
    density.prices.forEach((p, i) => {
      if (p >= x0 && p <= x1) d += `L${px(sx(p))} ${px(base - (density.density[i] / peak) * band)}`;
    });
    return `${d}L${px(sx(density.prices[density.prices.length - 1]))} ${px(base)}Z`;
  });

  const curvePath = $derived(linePath(curve));
  const expiryPath = $derived(linePath(expiry));
  const eventPath = $derived(eventCurve ? linePath(eventCurve) : "");
  const areaPath = $derived(`${curvePath}L${px(sx(x1))} ${px(zeroY)}L${px(sx(x0))} ${px(zeroY)}Z`);

  const read = (series: Float64Array, price: number) => {
    const [lower, upper, weight] = bracket(prices, price);
    return series[lower] * (1 - weight) + series[upper] * weight;
  };

  const spotVisible = $derived(spot >= x0 && spot <= x1);
  const spotOnLeft = $derived(sx(spot) < W * 0.62);

  // Break-even labels sit beside their dot, pointing away from each other. Where
  // there is no room beside it, a label is centred under its dot instead, kept
  // inside the plot, and moved across the zero line if it would hit its neighbour.
  type Anchor = "start" | "middle" | "end";
  const marks = $derived.by(() => {
    const visible = breakevens.filter((point) => point >= x0 && point <= x1);
    const roomBelow = zeroY + 22 < H - bottom;
    const left = margin.left;
    const right = W - margin.right;
    const result: { point: number; x: number; tx: number; anchor: Anchor; y: number; from: number; to: number }[] = [];
    visible.forEach((point, index) => {
      const x = sx(point);
      const size = 6 + `Break-even ${formatPrice(point)}`.length * 6.6;
      const outward: Anchor = visible.length > 1 ? (index === 0 ? "end" : "start") : x > W - 170 ? "end" : "start";
      let anchor: Anchor = outward;
      let tx = outward === "end" ? x - 8 : x + 8;
      let from = outward === "end" ? tx - size : tx;
      if (from < left || from + size > right) {
        tx = Math.min(Math.max(x, left + size / 2), right - size / 2);
        anchor = "middle";
        from = tx - size / 2;
      }
      const to = from + size;
      let y = roomBelow ? zeroY + 17 : zeroY - 9;
      const previous = result[result.length - 1];
      if (previous && previous.y === y && from < previous.to + 6 && previous.from < to + 6) {
        y = roomBelow ? zeroY - 9 : zeroY + 17;
      }
      result.push({ point, x, tx, anchor, y, from, to });
    });
    return result;
  });

  const hover = $derived.by(() => {
    if (hoverPrice == null) return null;
    const now = read(curve, hoverPrice);
    const end = read(expiry, hoverPrice);
    const after = eventCurve ? read(eventCurve, hoverPrice) : null;
    return { price: hoverPrice, now, end, after, x: sx(hoverPrice), yNow: sy(now), yEnd: sy(end) };
  });

  function priceAt(event: PointerEvent): number {
    const box = svgElement!.getBoundingClientRect();
    const x = ((event.clientX - box.left) * W) / box.width;
    const price = x0 + ((x - margin.left) / (W - margin.left - margin.right)) * (x1 - x0);
    return Math.min(x1, Math.max(x0, price));
  }

  function onMove(event: PointerEvent) {
    if (!dragging) hoverPrice = priceAt(event);
  }

  function startDrag(event: PointerEvent, handle: { key: string; indices: number[] }) {
    event.preventDefault();
    dragging = handle.key;
    hoverPrice = null;
    const indices = [...handle.indices];
    // Listening on the window keeps the drag alive even if the handle is redrawn mid-move.
    const move = (moveEvent: PointerEvent) => onstrike?.(indices, snap(priceAt(moveEvent), step));
    const stop = () => {
      dragging = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function onHandleKey(event: KeyboardEvent, handle: { strike: number; indices: number[] }) {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = snap(handle.strike + direction * step, step);
    if (next >= x0 && next <= x1) onstrike?.(handle.indices, next);
  }

  const summaryText = $derived(
    `Profit and loss by price, from ${formatPrice(x0)} to ${formatPrice(x1)}. ${label}. ` +
      (breakevens.length ? `Break-even at ${breakevens.map((point) => formatPrice(point)).join(" and ")}.` : "No break-even."),
  );
</script>

<div class="chart" class:stale bind:clientWidth={width}>
  <div class="legend">
    <span class="item">
      <svg class="sample" width="22" height="8" aria-hidden="true"><line class="s-curve" x1="0" y1="4" x2="22" y2="4" /></svg>
      {label}
    </span>
    {#if !atExpiry}
      <span class="item">
        <svg class="sample" width="22" height="8" aria-hidden="true"><line class="s-expiry" x1="0" y1="4" x2="22" y2="4" /></svg>
        At expiry
      </span>
    {/if}
    {#if eventPath}
      <span class="item">
        <svg class="sample" width="22" height="8" aria-hidden="true"><line class="s-event" x1="0" y1="4" x2="22" y2="4" /></svg>
        Day after earnings
      </span>
    {/if}
    {#if densityPath}
      <button type="button" class="item toggle" aria-pressed={showDensity} onclick={() => (showDensity = !showDensity)}>
        <svg class="sample" width="22" height="10" aria-hidden="true"><rect class="s-density" x="0" y="1" width="22" height="8" rx="2" /></svg>
        Likely finish
      </button>
    {/if}
    <span class="busy" aria-live="polite">{busy}</span>
  </div>

  <div class="plot">
    <svg
      bind:this={svgElement}
      class="canvas"
      viewBox="0 0 {W} {H}"
      height={H}
      role="group"
      aria-roledescription="chart"
      aria-label={summaryText}
      onpointermove={onMove}
      onpointerleave={() => (hoverPrice = null)}
    >
      <defs>
        <clipPath id="{uid}-up"><rect x="0" y="0" width={W} height={px(Math.max(0, zeroY))} /></clipPath>
        <clipPath id="{uid}-down"><rect x="0" y={px(zeroY)} width={W} height={px(Math.max(0, H - zeroY))} /></clipPath>
      </defs>

      <g class="grid">
        {#each yTicks as tick (tick)}
          <line x1={margin.left} x2={W - margin.right} y1={px(sy(tick))} y2={px(sy(tick))} />
        {/each}
      </g>
      <g class="axis">
        {#each yTicks as tick (tick)}
          <text x={margin.left - 8} y={px(sy(tick) + 4)} text-anchor="end">{axisMoney(tick)}</text>
        {/each}
        {#each visibleXTicks as tick (tick)}
          <text x={px(sx(tick))} y={H - 8} text-anchor="middle">{formatStrike(tick)}</text>
        {/each}
      </g>

      {#if showDensity && densityPath}<path class="density" d={densityPath} />{/if}
      <path class="area up" d={areaPath} clip-path="url(#{uid}-up)" />
      <path class="area down" d={areaPath} clip-path="url(#{uid}-down)" />
      <line class="zero" x1={margin.left} x2={W - margin.right} y1={px(zeroY)} y2={px(zeroY)} />

      {#if spotVisible}
        <line class="spot" x1={px(sx(spot))} x2={px(sx(spot))} y1={margin.top} y2={H - bottom} />
        <text class="note" x={px(sx(spot) + (spotOnLeft ? 6 : -6))} y={margin.top + 11} text-anchor={spotOnLeft ? "start" : "end"}>
          Price now {formatPrice(spot)}
        </text>
      {/if}

      {#if !atExpiry}<path class="expiry" d={expiryPath} />{/if}
      {#if eventPath}<path class="event" d={eventPath} />{/if}
      <path class="curve up" d={curvePath} clip-path="url(#{uid}-up)" />
      <path class="curve down" d={curvePath} clip-path="url(#{uid}-down)" />

      {#each marks as mark (mark.point)}
        <circle class="breakeven" cx={px(mark.x)} cy={px(zeroY)} r="3.5" />
        <text class="note" x={px(mark.tx)} y={px(mark.y)} text-anchor={mark.anchor}>
          Break-even {formatPrice(mark.point)}
        </text>
      {/each}

      {#if hover}
        <line class="cross" x1={px(hover.x)} x2={px(hover.x)} y1={margin.top} y2={H - bottom} />
        {#if !atExpiry}<circle class="dot end" cx={px(hover.x)} cy={px(hover.yEnd)} r="3.5" />{/if}
        <circle class="dot now" cx={px(hover.x)} cy={px(hover.yNow)} r="4.5" />
      {/if}

      {#each placed as handle (handle.key)}
        {@const top = 8 + handle.row * ROW}
        <g
          class="handle"
          class:active={dragging === handle.key}
          role="slider"
          tabindex="0"
          aria-label="Strike {handle.text}. Drag or use the arrow keys."
          aria-valuenow={handle.strike}
          aria-valuemin={x0}
          aria-valuemax={x1}
          transform="translate({px(handle.x)} {H - bottom})"
          onpointerdown={(event) => startDrag(event, handle)}
          onkeydown={(event) => onHandleKey(event, handle)}
        >
          <line y1="0" y2={top} />
          <rect x={px(handle.dx - handle.half)} y={top} width={px(handle.half * 2)} height="19" rx="3" />
          <text x={px(handle.dx)} y={top + 13.5} text-anchor="middle">{handle.text}</text>
        </g>
      {/each}
    </svg>

    {#if hover}
      <div class="tip" style="left: {Math.min(W - 96, Math.max(96, hover.x))}px; top: {Math.min(hover.yNow, hover.yEnd)}px">
        <div>at {formatPrice(hover.price)}</div>
        <div><span class="who">{curveName}</span> {signedMoney(hover.now)}</div>
        {#if hover.after != null}<div><span class="who">after earnings</span> {signedMoney(hover.after)}</div>{/if}
        {#if !atExpiry}<div><span class="who">expiry</span> {signedMoney(hover.end)}</div>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .chart {
    padding-top: 12px;
    min-width: 0;
  }
  .legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 18px;
    min-height: 22px;
    padding: 0 16px 2px 58px;
    font: 400 12px/1.4 var(--mono);
    color: var(--soft);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .busy {
    margin-left: auto;
    color: var(--accent);
  }
  .toggle {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .toggle[aria-pressed="false"] {
    opacity: 0.45;
    text-decoration: line-through;
  }
  .density,
  .s-density {
    fill: var(--accent);
    fill-opacity: 0.1;
    stroke: var(--accent);
    stroke-opacity: 0.4;
    stroke-width: 1;
  }
  .plot {
    position: relative;
  }
  .canvas {
    display: block;
    width: 100%;
    cursor: crosshair;
    touch-action: pan-y;
    transition: opacity 0.2s;
  }
  .stale .canvas {
    opacity: 0.35;
  }
  .grid line {
    stroke: var(--grid);
  }
  .axis text {
    fill: var(--muted);
    font: 400 11px var(--mono);
  }
  .zero {
    stroke: var(--zero);
  }
  .spot {
    stroke: var(--muted);
    stroke-dasharray: 2 3;
  }
  .note {
    fill: var(--soft);
    font: italic 400 13px var(--serif);
    /* A halo in the background colour keeps labels readable where they cross a line. */
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
  }
  .event,
  .s-event {
    fill: none;
    stroke: var(--series-2);
    stroke-width: 1.5;
    stroke-dasharray: 8 3 2 3;
  }
  .expiry,
  .s-expiry {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.25;
    stroke-dasharray: 5 4;
  }
  .curve {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .curve.up {
    stroke: var(--profit);
  }
  .curve.down {
    stroke: var(--loss);
  }
  .s-curve {
    stroke: var(--ink);
    stroke-width: 2;
  }
  .area.up {
    fill: var(--profit);
    opacity: 0.11;
  }
  .area.down {
    fill: var(--loss);
    opacity: 0.11;
  }
  .breakeven {
    fill: var(--accent);
  }
  .cross {
    stroke: var(--accent);
  }
  .dot.now {
    fill: var(--bg);
    stroke: var(--ink);
    stroke-width: 2;
  }
  .dot.end {
    fill: var(--accent);
  }
  .handle {
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }
  .handle line {
    stroke: var(--muted);
  }
  .handle rect {
    fill: var(--bg);
    stroke: var(--muted);
  }
  .handle text {
    fill: var(--ink);
    font: 500 11px var(--mono);
    user-select: none;
  }
  .handle:hover rect,
  .handle:focus-visible rect,
  .handle.active rect {
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    transform: translate(-50%, calc(-100% - 12px));
    background: var(--ink);
    color: var(--bg);
    border-radius: 4px;
    padding: 6px 10px;
    font: 500 11.5px/1.55 var(--mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tip .who {
    opacity: 0.65;
  }
  @media (max-width: 560px) {
    .legend {
      padding-left: 16px;
    }
  }
</style>
