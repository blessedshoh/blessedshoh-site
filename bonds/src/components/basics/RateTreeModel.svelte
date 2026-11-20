<script lang="ts">
  import Card from "./Card.svelte";
  import Figures from "../Figures.svelte";
  import TreeDiagram from "../TreeDiagram.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f } from "./fmt.ts";

  interface Result {
    value: number;
    straightValue: number;
    optionValue: number;
    lowestRates: number[];
    nodes: { rate: number; value: number; exercised: boolean }[][];
  }
  let { inputs, result }: { inputs: Inputs; result: Result } = $props();
  const option = $derived(inputs.option as string);
  const levels = $derived(
    result.nodes.map((level) => level.map((n) => ({ lines: [f(n.value, 3), `r ${f(n.rate, 3)}%`], highlight: n.exercised }))),
  );
  const word = $derived(option === "call" ? "called" : option === "put" ? "put" : "exercised");
</script>

<Figures
  items={[
    [option === "none" ? "Bond value" : `${option === "call" ? "Callable" : "Putable"} bond`, f(result.value)],
    ["Straight bond", f(result.straightValue)],
    [option === "put" ? "Put worth to holder" : "Option value", f(Math.abs(result.optionValue))],
  ]}
/>
<Card>
  <TreeDiagram {levels} label="Interest rate tree with bond values" legend={option === "none" ? "value at each node, then the one-year rate" : `value at each node; highlighted where the bond is ${word}`} />
</Card>
<Work hint="Backward induction on the tree">
  <p>
    Rates at each year step up from the lowest by e^(2σ), σ = {inputs.volatility}%: r_up = r_down · e^(2σ). Lowest rates per year:
    {result.lowestRates.map((r) => `${f(r, 4)}%`).join(", ")}{inputs.source === "par" ? ", fitted so the tree prices each par bond at 100" : ""}.
  </p>
  <span class="eq">V(node) = ½ · (V_up + C + V_down + C) / (1 + r(node))
{option === "call" ? `then V = min(V, ${inputs.strike}) from year ${inputs.firstExerciseYear}: the issuer calls when the bond is worth more than the call price` : option === "put" ? `then V = max(V, ${inputs.strike}) from year ${inputs.firstExerciseYear}: the holder puts when the bond is worth less` : "no option: straight bond"}</span>
  <p class="aside">
    Straight bond {f(result.straightValue)} − with the option {f(result.value)} = {f(result.optionValue)}: what the {option === "put" ? "holder's put adds" : "issuer's call costs the holder"}.
  </p>
</Work>
