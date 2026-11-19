<script lang="ts">
  // Horizontal bars of DV01 by curve maturity. One or two bars per row (before and after a hedge).
  interface Row {
    tenor: string;
    values: number[];
  }
  interface Props {
    rows: Row[];
    labels: string[];
    unit: string;
  }

  let { rows, labels, unit }: Props = $props();
  const COLORS = ["var(--accent)", "var(--series-2)"];
  const largest = $derived(Math.max(1e-12, ...rows.flatMap((r) => r.values.map(Math.abs))));
  const width = (v: number) => `${((Math.abs(v) / largest) * 50).toFixed(2)}%`;
</script>

<div class="krd">
  <div class="legend">
    {#each labels as label, i (label)}<span><span class="swatch" style="background: {COLORS[i]}"></span>{label}</span>{/each}
    <span class="unit">{unit}</span>
  </div>
  {#each rows as row (row.tenor)}
    <div class="row">
      <span class="tenor">{row.tenor}</span>
      <span class="bars">
        {#each row.values as v, i (i)}
          <span class="track">
            <span class="bar" style="width: {width(v)}; {v < 0 ? 'right: 50%' : 'left: 50%'}; background: {COLORS[i]}"></span>
          </span>
        {/each}
      </span>
      <span class="num values">{row.values.map((v) => v.toLocaleString("en-US", { maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 0 })).join(" → ")}</span>
    </div>
  {/each}
</div>

<style>
  .legend {
    display: flex;
    gap: 16px;
    font: 500 11px/1.4 var(--mono);
    color: var(--muted);
    margin-bottom: 8px;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    vertical-align: -1px;
  }
  .unit {
    margin-left: auto;
  }
  .row {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 150px;
    gap: 12px;
    align-items: center;
    padding: 4px 0;
    font-size: 13px;
  }
  .tenor {
    font: 500 12px var(--mono);
    color: var(--soft);
  }
  .bars {
    display: grid;
    gap: 2px;
  }
  .track {
    position: relative;
    height: 9px;
    background: linear-gradient(to right, transparent calc(50% - 0.5px), var(--line) calc(50% - 0.5px), var(--line) calc(50% + 0.5px), transparent calc(50% + 0.5px));
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 1px;
  }
  .values {
    text-align: right;
    font-size: 12px;
    color: var(--soft);
  }
  @media (max-width: 560px) {
    .row {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .values {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
