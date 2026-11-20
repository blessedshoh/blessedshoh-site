<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  interface Result {
    price: number;
    modified: number;
    convexity: number;
    durationEstimate: number;
    durationConvexityEstimate: number;
    truePrice: number;
    errorDuration: number;
    errorDurationConvexity: number;
    lines: { ytm: number; truePrice: number; duration: number; durationConvexity: number }[];
  }
  let { inputs, result }: { inputs: Inputs; result: Result } = $props();
  const target = $derived((inputs.ytm as number) + (inputs.shift as number));
  const series = $derived([
    { key: "true", label: "True price", color: "var(--accent)", style: "line" as const, points: result.lines.map((r) => ({ x: r.ytm, y: r.truePrice })) },
    { key: "dur", label: "Duration (tangent)", color: "var(--series-2)", style: "dash" as const, points: result.lines.map((r) => ({ x: r.ytm, y: r.duration })) },
    { key: "conv", label: "Duration + convexity", color: "var(--series-3)", style: "dot" as const, points: result.lines.map((r) => ({ x: r.ytm, y: r.durationConvexity })) },
  ]);
  const dy = $derived(`${(inputs.shift as number) >= 0 ? "" : "−"}${f(Math.abs(inputs.shift as number) / 100, 4)}`);
</script>

<Figures
  items={[
    [`True price at ${target}%`, f(result.truePrice)],
    ["Duration estimate", f(result.durationEstimate)],
    ["Duration + convexity", f(result.durationConvexityEstimate)],
    ["Duration error", `${f(result.errorDuration * 100, 2)}%`],
    ["With convexity", `${f(result.errorDurationConvexity * 100, 2)}%`],
  ]}
/>
<Card>
  <LineChart {series} xLabel="Yield" xUnit="%" yLabel="price" label="True price, tangent line and convexity curve" marker={{ x: target, label: `${target}%` }} />
</Card>
<Work hint="A straight line against a curve">
  <p>At {inputs.ytm}% the bond is worth {f(result.price)}, with modified duration {f(result.modified)} and convexity {f(result.convexity, 2)}. For a move of Δy = {dy}:</p>
  <span class="eq">duration:        P − D*·P·Δy             = {f(result.price)} − {f(result.modified)} × {f(result.price)} × ({dy}) = {f(result.durationEstimate)}
with convexity:  P − D*·P·Δy + ½·C·P·Δy² = {f(result.durationConvexityEstimate)}
true price:      P(y + Δy)               = {f(result.truePrice)}</span>
  <p class="aside">The tangent misses by {f(result.errorDuration * 100, 2)}% because the price–yield curve bends; adding convexity cuts the miss to {f(result.errorDurationConvexity * 100, 2)}%. The bigger the move, the worse both get.</p>
</Work>
