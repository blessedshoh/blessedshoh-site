<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  let { inputs, result }: { inputs: Inputs; result: { path: { yearsLeft: number; low: number; high: number }[] } } = $props();
  const years = $derived(inputs.years as number);
  const series = $derived([
    { key: "low", label: `${inputs.lowCoupon}% coupon`, color: "var(--accent)", style: "line" as const, points: result.path.map((r) => ({ x: years - r.yearsLeft, y: r.low })) },
    { key: "high", label: `${inputs.highCoupon}% coupon`, color: "var(--series-2)", style: "line" as const, points: result.path.map((r) => ({ x: years - r.yearsLeft, y: r.high })) },
  ]);
  const p0 = $derived(result.path[0]);
  const p1 = $derived(result.path[1] ?? result.path[0]);
</script>

<Figures items={[[`${inputs.lowCoupon}% coupon today`, f(p0.low)], [`${inputs.highCoupon}% coupon today`, f(p0.high)], ["Both at maturity", f(inputs.face as number, 2)]]} />
<Card>
  <LineChart {series} xLabel="Years from today" yLabel={`price, yield held at ${inputs.ytm}%`} label="Price over the bond's life" />
</Card>
<Work hint="Pull to par">
  <p>Each point reprices the bond with one year fewer to run, the yield held at {inputs.ytm}%:</p>
  <span class="eq">year 0, {years} years left: {f(p0.low)} and {f(p0.high)}
year 1, {p1.yearsLeft} years left: {f(p1.low)} and {f(p1.high)}</span>
  <p class="aside">A bond priced below face rises toward it, one priced above falls toward it: at maturity both are worth the face.</p>
</Work>
