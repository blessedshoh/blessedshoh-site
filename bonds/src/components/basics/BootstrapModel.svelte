<script lang="ts">
  import Card from "./Card.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  let { inputs, result }: { inputs: Inputs; result: { spots: number[] } } = $props();
  const m = $derived(inputs.frequency as number);
  const pars = $derived(inputs.parYields as number[]);
  const bills = $derived(inputs.billPeriods as number);
  const rows = $derived(result.spots.map((spot, k) => ({ period: k + 1, years: (k + 1) / m, par: pars[k], spot })));
  const series = $derived([
    { key: "par", label: "Par yield", color: "var(--series-2)", style: "points" as const, points: rows.map((r) => ({ x: r.years, y: r.par })) },
    { key: "spot", label: "Spot rate", color: "var(--accent)", style: "line" as const, points: rows.map((r) => ({ x: r.years, y: r.spot })) },
  ]);
  const last = $derived(rows[rows.length - 1]);
</script>

<Card>
  <LineChart {series} xLabel="Maturity" xUnit="y" yLabel="percent" yDigits={4} label="Par yields and bootstrapped spot rates" />
</Card>
<div class="scroll">
  <table class="num">
    <thead><tr><th>Period</th><th>Years</th><th>Par yield</th><th>Spot rate</th><th>Priced as</th></tr></thead>
    <tbody>
      {#each rows as r (r.period)}
        <tr><td>{r.period}</td><td>{f(r.years, 2)}</td><td>{f(r.par, 4)}%</td><td>{f(r.spot, 4)}%</td><td>{r.period <= bills ? "bill: spot = par" : "coupon bond"}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<Work hint="One unknown at a time">
  <p>
    The first {bills} maturities are bills, so their yields are already spot rates. Each longer par bond is worth 100: its earlier coupons are
    discounted at spot rates already found, which leaves one unknown, the spot rate at its own maturity. For the last one ({f(last.years, 2)} years):
  </p>
  <span class="eq">100 = Σ(t&lt;{last.period}) ({f(last.par, 4)}/{m}) / (1 + z_t/{m})^t + (100 + {f(last.par, 4)}/{m}) / (1 + z/{m})^{last.period}
  →  z = {f(last.spot, 4)}%</span>
</Work>

<style>
  .scroll {
    overflow-x: auto;
    margin: 18px 0 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: right;
    font: 500 10.5px/1.4 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  td {
    text-align: right;
    padding: 6px 0 6px 12px;
    border-bottom: 1px solid var(--grid);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
  }
</style>
