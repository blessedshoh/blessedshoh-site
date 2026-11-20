<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  interface Result {
    macaulay: number;
    modified: number;
    convexity: number;
    dv01: number;
    curve: { ytm: number; macaulay: number; modified: number; convexity: number }[];
  }
  let { inputs, result }: { inputs: Inputs; result: Result } = $props();
  const series = $derived([
    { key: "mac", label: "Macaulay", color: "var(--accent)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.macaulay })) },
    { key: "mod", label: "Modified", color: "var(--series-2)", style: "line" as const, points: result.curve.map((r) => ({ x: r.ytm, y: r.modified })) },
  ]);
</script>

<Figures
  items={[
    ["Macaulay duration", `${f(result.macaulay)} yrs`],
    ["Modified duration", f(result.modified)],
    ["Convexity", f(result.convexity, 2)],
    ["DV01", f(result.dv01)],
  ]}
/>
<Card>
  <LineChart {series} xLabel="Yield" xUnit="%" yLabel="duration, years" label="Duration against yield" marker={{ x: inputs.ytm as number, label: `${inputs.ytm}%` }} />
</Card>
<Work hint="Weighted time, then sensitivity">
  <span class="eq">Macaulay  D = Σ t · PV(CF_t) / P = {f(result.macaulay)} years
Modified  D* = D / (1 + y/m) = {f(result.macaulay)} / (1 + {inputs.ytm}%/{inputs.frequency}) = {f(result.modified)}
DV01      = D* · P · 0.0001 = {f(result.dv01)}
Convexity C = Σ t(t+1) · PV(CF_t) / (P · (1 + y/m)²) / m² = {f(result.convexity, 2)}</span>
  <p class="aside">Duration falls as the yield rises: higher yields shrink the present value of the distant payments more than the near ones.</p>
</Work>
