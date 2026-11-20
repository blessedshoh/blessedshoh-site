<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import TreeDiagram from "../TreeDiagram.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  interface Node {
    stock: number;
    hold: number;
    convert: number;
    value: number;
    converts: boolean;
  }
  let { inputs, result }: { inputs: Inputs; result: { value: number; upProbability: number; nodes: Node[][] } } = $props();
  const today = $derived(result.nodes[0][0]);
  const levels = $derived(
    result.nodes.map((level) => level.map((n) => ({ lines: [f(n.value, 2), `stock ${f(n.stock, 2)}`, `hold ${f(n.hold, 0)} · convert ${f(n.convert, 0)}`], highlight: n.converts }))),
  );
</script>

<Figures
  items={[
    ["Convertible value", f(result.value)],
    ["Convert today", f(today.convert, 2)],
    ["Hold today", f(today.hold)],
    ["Up probability", f(result.upProbability, 4)],
  ]}
/>
<Card>
  <TreeDiagram {levels} label="Stock tree with convertible values" legend="value at each node; highlighted where converting beats holding" />
</Card>
<Work hint="Hold or convert, node by node">
  <p>
    The stock moves up by u = e^(σ) or down by 1/u each year (σ = {inputs.volatility}%). With r = {inputs.rate}% and a {inputs.dividendYield}% dividend yield the
    risk-neutral up probability is p = (e^(r − q) − d) / (u − d) = {f(result.upProbability, 4)}.
  </p>
  <span class="eq">convert = {inputs.conversionRatio} × S{inputs.couponOnConversion ? " + coupon" : ""}
hold    = (p · V_up + (1 − p) · V_down) / e^r + coupon   (no coupon at today's node)
V       = max(hold, convert)
today:  max({f(today.hold, 2)}, {f(today.convert, 2)}) = {f(result.value, 2)}</span>
  <p class="aside">{inputs.couponOnConversion ? "The coupon is still paid in the year the bond converts." : "Converting gives up that year's coupon."} At maturity the holder takes the larger of face plus coupon and the shares.</p>
</Work>
