<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { change, f } from "./fmt.ts";

  interface Result {
    low: number;
    high: number;
    curve: { ytm: number; low: number; high: number }[];
  }
  let { inputs, result }: { inputs: Inputs; result: Result } = $props();
  const series = $derived([
    { key: "low", label: `${inputs.lowCoupon}% coupon`, color: "var(--accent)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.low })) },
    { key: "high", label: `${inputs.highCoupon}% coupon`, color: "var(--series-2)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.high })) },
  ]);
  const first = $derived(result.curve[0]);
  const last = $derived(result.curve[result.curve.length - 1]);
</script>

<Figures items={[[`${inputs.lowCoupon}% coupon at ${inputs.ytm}%`, f(result.low)], [`${inputs.highCoupon}% coupon at ${inputs.ytm}%`, f(result.high)]]} />
<Card>
  <LineChart {series} xLabel="Yield" xUnit="%" yLabel="price" label="Price against yield for two coupons" marker={{ x: inputs.ytm as number, label: `${inputs.ytm}%` }} />
</Card>
<Work hint="Why the low coupon moves more">
  <p>Both bonds run {inputs.years} years and are priced with the same formula. From a {first.ytm}% to a {last.ytm}% yield:</p>
  <span class="eq">{inputs.lowCoupon}% coupon: {f(first.low, 2)} → {f(last.low, 2)}  ({change(first.low, last.low)})
{inputs.highCoupon}% coupon: {f(first.high, 2)} → {f(last.high, 2)}  ({change(first.high, last.high)})</span>
  <p class="aside">A low coupon puts more of the value in the final payment, the one furthest out, so its price is more sensitive to the yield in percentage terms.</p>
</Work>
