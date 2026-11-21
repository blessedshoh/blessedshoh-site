<script lang="ts">
  // Each factor's share of the variance of daily curve moves, as bars. Shares arrive from
  // bondlab; this only draws them.
  interface Bar {
    label: string;
    share: number;
    color: string;
  }

  let { bars }: { bars: Bar[] } = $props();

  let width = $state(360);
  const ROW = 34;
  const LABEL = 92;
  const VALUE = 54;
  const height = $derived(bars.length * ROW);
  const span = $derived(Math.max(40, width - LABEL - VALUE));
</script>

<div class="bars" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label="Share of the variance of daily moves explained by each factor">
    {#each bars as bar, i (bar.label)}
      <text class="label" x="0" y={i * ROW + ROW / 2 + 4}>{bar.label}</text>
      <rect class="track" x={LABEL} y={i * ROW + 8} width={span} height={ROW - 16} rx="3" />
      <rect x={LABEL} y={i * ROW + 8} width={Math.max(1, span * Math.min(1, Math.max(0, bar.share)))} height={ROW - 16} rx="3" fill={bar.color} />
      <text class="value num" x={width} y={i * ROW + ROW / 2 + 4} text-anchor="end">{(bar.share * 100).toFixed(1)}%</text>
    {/each}
  </svg>
</div>

<style>
  .bars {
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .label {
    font: 500 12px var(--mono);
    fill: var(--soft);
  }
  .value {
    font: 500 12.5px var(--mono);
    fill: var(--ink);
  }
  .track {
    fill: var(--grid);
  }
</style>
