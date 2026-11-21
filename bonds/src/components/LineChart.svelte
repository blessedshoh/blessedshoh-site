<script lang="ts">
  // A general line chart for the coursework models: any x and y, rounded ticks, hover readout.
  // Every point arrives ready-made from the API.
  import type { ChartSeries } from "../lib/types.ts";

  interface Props {
    series: ChartSeries[];
    xLabel: string;
    yLabel: string;
    xUnit?: string;
    yDigits?: number;
    /** A dashed vertical line, e.g. at today's yield. */
    marker?: { x: number; label: string } | null;
    /** How x values are written on the axis and in the readout (dates, for one). */
    xFormat?: ((x: number) => string) | null;
    label: string;
  }

  let { series, xLabel, yLabel, xUnit = "", yDigits = 2, marker = null, xFormat = null, label }: Props = $props();

  let width = $state(760);
  const H = $derived(Math.round(Math.max(220, Math.min(340, width * 0.42))));
  const PAD = { left: 54, right: 14, top: 14, bottom: 34 };

  function nice(lo: number, hi: number, count = 5): number[] {
    const span = hi - lo || Math.abs(hi) || 1;
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }

  const all = $derived(series.flatMap((s) => s.points));
  const xRange = $derived(all.length ? [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))] : [0, 1]);
  const yRange = $derived.by(() => {
    if (all.length === 0) return [0, 1];
    const lo = Math.min(...all.map((p) => p.y));
    const hi = Math.max(...all.map((p) => p.y));
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    return [lo - pad, hi + pad];
  });
  const sx = (x: number) => PAD.left + ((x - xRange[0]) / (xRange[1] - xRange[0] || 1)) * (width - PAD.left - PAD.right);
  const sy = (y: number) => PAD.top + ((yRange[1] - y) / (yRange[1] - yRange[0] || 1)) * (H - PAD.top - PAD.bottom);
  const xTicks = $derived(nice(xRange[0], xRange[1], width < 480 ? 4 : 7));
  const yTicks = $derived(nice(yRange[0], yRange[1]).filter((t) => t >= yRange[0] && t <= yRange[1]));
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
  const path = (points: { x: number; y: number }[]) => points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join("");

  let hoverX = $state<number | null>(null);
  const readout = $derived.by(() => {
    if (hoverX === null || all.length === 0) return null;
    const x = xRange[0] + ((hoverX - PAD.left) / (width - PAD.left - PAD.right)) * (xRange[1] - xRange[0]);
    if (x < xRange[0] || x > xRange[1]) return null;
    const rows = series
      .filter((s) => s.points.length > 0)
      .map((s) => {
        const p = s.points.reduce((best, q) => (Math.abs(q.x - x) < Math.abs(best.x - x) ? q : best));
        return { label: s.label, color: s.color, x: p.x, y: p.y };
      });
    return { x: rows[0]?.x ?? x, rows };
  });
</script>

<div class="chart" bind:clientWidth={width}>
  <div class="legend">
    {#each series as s (s.key)}
      <span class="item"><span class="swatch {s.style}" style="--c: {s.color}"></span>{s.label}</span>
    {/each}
    <span class="unit">{yLabel}</span>
  </div>
  <svg
    {width}
    height={H}
    role="img"
    aria-label={label}
    onpointermove={(e) => (hoverX = e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left)}
    onpointerleave={() => (hoverX = null)}
  >
    {#each yTicks as t (t)}
      <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
      <text class="tick" x={PAD.left - 8} y={sy(t) + 4} text-anchor="end">{fmt(t)}</text>
    {/each}
    {#each xTicks as t (t)}
      <text class="tick" x={sx(t)} y={H - 16} text-anchor="middle">{xFormat ? xFormat(t) : fmt(t)}{xUnit}</text>
    {/each}
    <text class="axis" x={width - PAD.right} y={H - 2} text-anchor="end">{xLabel}</text>
    {#if marker}
      <line class="marker" x1={sx(marker.x)} x2={sx(marker.x)} y1={PAD.top} y2={H - PAD.bottom} />
      <text class="tick" x={sx(marker.x) + 5} y={PAD.top + 10}>{marker.label}</text>
    {/if}
    {#each series as s (s.key)}
      {#if s.style === "points"}
        {#each s.points as p, i (i)}<circle cx={sx(p.x)} cy={sy(p.y)} r="3.2" fill={s.color} />{/each}
      {:else if s.points.length > 1}
        <path class="line {s.style}" d={path(s.points)} stroke={s.color} />
      {/if}
    {/each}
    {#if readout}<line class="cursor" x1={sx(readout.x)} x2={sx(readout.x)} y1={PAD.top} y2={H - PAD.bottom} />{/if}
  </svg>
  {#if readout}
    <div class="tip" style="left: {Math.min(width - 190, Math.max(0, sx(readout.x) + 10))}px">
      <div class="num">{xLabel}: {xFormat ? xFormat(readout.x) : fmt(readout.x)}{xUnit}</div>
      {#each readout.rows as row (row.label)}
        <div><span class="dot" style="background: {row.color}"></span>{row.label} <b class="num">{row.y.toFixed(yDigits)}</b></div>
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
  .unit {
    margin-left: auto;
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
  .marker,
  .cursor {
    stroke: var(--muted);
    stroke-dasharray: 2 3;
  }
  .tip {
    position: absolute;
    top: 28px;
    width: 180px;
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
