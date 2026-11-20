<script lang="ts">
  // A recombining binomial tree drawn as a grid: one column per year, the highest node on top.
  // Each node's lines come ready-made; highlighted nodes are where the option is exercised.
  interface Node {
    lines: string[];
    highlight: boolean;
  }
  interface Props {
    /** levels[i][j]: year i, node j, with j = 0 the lowest. */
    levels: Node[][];
    label: string;
    legend: string;
  }

  let { levels, label, legend }: Props = $props();
  const n = $derived(levels.length);
  // Year i, node j sits on row (n-1-i) + 2(i-j) + 1, so neighbours recombine visually.
  const row = (i: number, j: number) => n - 1 - i + 2 * (i - j) + 1;
</script>

<div class="wrap">
  <p class="legend"><span class="swatch"></span>{legend}</p>
  <div class="tree" role="img" aria-label={label} style="grid-template-columns: repeat({n}, minmax(110px, 1fr)); grid-template-rows: repeat({2 * n - 1}, auto)">
    {#each levels as level, i (i)}
      <div class="year" style="grid-column: {i + 1}; grid-row: 1 / span 1">Year {i}</div>
      {#each level as node, j (j)}
        <div class="node num" class:hit={node.highlight} style="grid-column: {i + 1}; grid-row: {row(i, j)}">
          {#each node.lines as line, k (k)}<div class:main={k === 0}>{line}</div>{/each}
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  .legend {
    font: 500 11px/1.4 var(--mono);
    color: var(--muted);
    margin: 0 0 8px;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    vertical-align: -1px;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .tree {
    display: grid;
    gap: 4px 10px;
    align-items: center;
    padding-top: 22px;
    position: relative;
  }
  .year {
    position: absolute;
    top: 0;
    font: 500 10.5px/1.4 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .node {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 8px;
    font-size: 11.5px;
    color: var(--muted);
    background: var(--panel);
  }
  .node .main {
    font-size: 13px;
    color: var(--ink);
  }
  .node.hit {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  }
</style>
