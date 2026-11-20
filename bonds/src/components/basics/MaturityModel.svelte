<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { change, f } from "./fmt.ts";

  interface Result {
    short: number;
    long: number;
    curve: { ytm: number; short: number; long: number }[];
  }
  let { inputs, result }: { inputs: Inputs; result: Result } = $props();
  const series = $derived([
    { key: "short", label: `${inputs.shortYears} years`, color: "var(--accent)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.short })) },
    { key: "long", label: `${inputs.longYears} years`, color: "var(--series-2)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.long })) },
  ]);
  const first = $derived(result.curve[0]);
  const last = $derived(result.curve[result.curve.length - 1]);
</script>

<Figures items={[[`${inputs.shortYears}-year bond at ${inputs.ytm}%`, f(result.short)], [`${inputs.longYears}-year bond at ${inputs.ytm}%`, f(result.long)]]} />
<Card>
  <LineChart {series} xLabel="Yield" xUnit="%" yLabel="price" label="Price against yield for two maturities" marker={{ x: inputs.ytm as number, label: `${inputs.ytm}%` }} />
</Card>
<Work hint="Why the long bond moves more">
  <p>Same {inputs.coupon}% coupon, two maturities. From a {first.ytm}% to a {last.ytm}% yield:</p>
  <span class="eq">{inputs.shortYears} years: {f(first.short, 2)} → {f(last.short, 2)}  ({change(first.short, last.short)})
{inputs.longYears} years: {f(first.long, 2)} → {f(last.long, 2)}  ({change(first.long, last.long)})</span>
  <p class="aside">Payments further out are discounted over more periods, so a change in the yield compounds over more years.</p>
</Work>
