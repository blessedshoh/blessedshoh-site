<script lang="ts">
  // A rates chart: x is years to maturity, y is percent. Lines and dots only; every
  // number arrives ready-made from the page (published yields) or the API.
  import type { ChartSeries } from "../lib/types.ts";

  interface Props {
    series: ChartSeries[];
    /** Short status beside the legend, empty when idle. */
    busy?: string;
    xLabel?: string;
  }

  let { series, busy = "", xLabel = "Years to maturity" }: Props = $props();

  let width = $state(760);
  const H = $derived(Math.round(Math.max(240, Math.min(380, width * 0.45))));
  const PAD = { left: 46, right: 14, top: 14, bottom: 30 };

  const all = $derived(series.flatMap((s) => s.points));
  const xMax = $derived(Math.max(1, ...all.map((p) => p.x)));
  const yRange = $derived.by(() => {
    if (all.length === 0) return [0, 1];
    let lo = Math.min(...all.map((p) => p.y));
    let hi = Math.max(...all.map((p) => p.y));
    const pad = Math.max(0.15, (hi - lo) * 0.12);
    return [Math.floor((lo - pad) * 4) / 4, Math.ceil((hi + pad) * 4) / 4];
  });

  const sx = (x: number) => PAD.left + (x / xMax) * (width - PAD.left - PAD.right);
  const sy = (y: number) => PAD.top + ((yRange[1] - y) / (yRange[1] - yRange[0] || 1)) * (H - PAD.top - PAD.bottom);

  const xTicks = $derived([0, 1, 2, 5, 10, 20, 30].filter((t) => t <= xMax + 0.01));
  const yTicks = $derived.by(() => {
    const [lo, hi] = yRange;
    const step = hi - lo > 4 ? 1 : hi - lo > 2 ? 0.5 : 0.25;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));
    return ticks;
  });

  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join("");

  let hoverX = $state<number | null>(null);
  const readout = $derived.by(() => {
    if (hoverX === null) return null;
    const x = ((hoverX - PAD.left) / (width - PAD.left - PAD.right)) * xMax;
    if (x < 0 || x > xMax) return null;
    const rows = series
      .filter((s) => s.points.length > 0)
      .map((s) => {
        const nearest = s.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
        return { label: s.label, color: s.color, x: nearest.x, y: nearest.y };
      });
    return { x, rows };
  });

  function move(event: PointerEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    hoverX = event.clientX - box.left;
  }
</script>

<div class="chart" bind:clientWidth={width}>
  <div class="legend">
    {#each series as s (s.key)}
      <span class="item"><span class="swatch {s.style}" style="--c: {s.color}"></span>{s.label}</span>
    {/each}
    {#if busy}<span class="busy">{busy}</span>{/if}
  </div>
  <svg {width} height={H} role="img" aria-label="Yield curve" onpointermove={move} onpointerleave={() => (hoverX = null)}>
    {#each yTicks as t (t)}
      <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
      <text class="tick" x={PAD.left - 8} y={sy(t) + 4} text-anchor="end">{t.toFixed(2)}%</text>
    {/each}
    {#each xTicks as t (t)}
      <text class="tick" x={sx(t)} y={H - 10} text-anchor="middle">{t}</text>
    {/each}
    <text class="axis" x={width - PAD.right} y={H - 10} text-anchor="end">{xLabel}</text>
    {#each series as s (s.key)}
      {#if s.style === "points"}
        {#each s.points as p, i (i)}
          <circle cx={sx(p.x)} cy={sy(p.y)} r="3.2" fill={s.color} />
        {/each}
      {:else if s.points.length > 1}
        <path class="line {s.style}" d={path(s.points)} stroke={s.color} />
      {/if}
    {/each}
    {#if readout}
      <line class="cursor" x1={sx(readout.x)} x2={sx(readout.x)} y1={PAD.top} y2={H - PAD.bottom} />
    {/if}
  </svg>
  {#if readout}
    <div class="tip" style="left: {Math.min(width - 170, Math.max(0, sx(readout.x) + 10))}px">
      <div class="num">{readout.x.toFixed(1)} years</div>
      {#each readout.rows as row (row.label)}
        <div><span class="dot" style="background: {row.color}"></span>{row.label} <b class="num">{row.y.toFixed(3)}%</b></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: center;
    font: 500 11px/1.4 var(--mono);
    color: var(--muted);
    margin-bottom: 6px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 18px;
    height: 0;
    border-top: 2px solid var(--c);
  }
  .swatch.dash {
    border-top-style: dashed;
  }
  .swatch.dot {
    border-top-style: dotted;
  }
  .swatch.points {
    width: 7px;
    height: 7px;
    border: 0;
    border-radius: 50%;
    background: var(--c);
  }
  .busy {
    color: var(--accent);
    margin-left: auto;
  }
  svg {
    display: block;
    touch-action: pan-y;
  }
  .grid {
    stroke: var(--grid);
  }
  .tick,
  .axis {
    font: 500 10px var(--mono);
    fill: var(--muted);
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .line.dash {
    stroke-dasharray: 6 4;
    stroke-width: 1.6;
  }
  .line.dot {
    stroke-dasharray: 2 4;
    stroke-width: 1.6;
  }
  .cursor {
    stroke: var(--muted);
    stroke-dasharray: 2 3;
  }
  .tip {
    position: absolute;
    top: 28px;
    width: 160px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 12px;
    pointer-events: none;
    display: grid;
    gap: 3px;
  }
  .tip b {
    font-weight: 500;
    float: right;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 6px;
  }
</style>
