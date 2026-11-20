<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import LineChart from "../LineChart.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  interface Row {
    yearsLeft: number;
    oldYield: number;
    newYield: number;
    actual: number;
  }
  let { inputs, result }: { inputs: Inputs; result: { path: Row[] } } = $props();
  const years = $derived(inputs.years as number);
  const year = $derived(inputs.yearOfChange as number);
  const pts = (k: "oldYield" | "newYield" | "actual") => result.path.map((r) => ({ x: years - r.yearsLeft, y: r[k] }));
  const series = $derived([
    { key: "old", label: `${inputs.ytm}% throughout`, color: "var(--muted)", style: "dash" as const, points: pts("oldYield") },
    { key: "new", label: `${inputs.newYtm}% throughout`, color: "var(--series-2)", style: "dash" as const, points: pts("newYield") },
    { key: "actual", label: "Actual path", color: "var(--accent)", style: "line" as const, points: pts("actual") },
  ]);
  const before = $derived(result.path[Math.max(0, year - 1)]);
  const at = $derived(result.path[year]);
</script>

<Figures items={[["Price today", f(result.path[0].actual)], [`Year ${Math.max(0, year - 1)}`, f(before.actual)], [`Year ${year}, after the change`, f(at.actual)]]} />
<Card>
  <LineChart {series} xLabel="Years from today" yLabel="price" label="Price path when the yield changes" marker={{ x: year, label: "yield changes" }} />
</Card>
<Work hint="The jump when the yield moves">
  <p>Before year {year} the bond is priced at {inputs.ytm}%; from year {year} on at {inputs.newYtm}%, with {years - year} years left:</p>
  <span class="eq">year {Math.max(0, year - 1)}: P({years - Math.max(0, year - 1)} years, {inputs.ytm}%) = {f(before.actual)}
year {year}: P({years - year} years, {inputs.newYtm}%) = {f(at.actual)}</span>
  <p class="aside">The price jumps from one constant-yield path to the other, then pulls to par along the new one.</p>
</Work>
