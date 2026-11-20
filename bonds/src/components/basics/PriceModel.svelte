<script lang="ts">
  import Figures from "../Figures.svelte";
  import Work from "../Work.svelte";
  import type { Inputs } from "../../lib/basics.ts";
  import { f, FREQ_NAME } from "./fmt.ts";

  let { inputs, result }: { inputs: Inputs; result: { price: number } } = $props();
  const m = $derived(inputs.frequency as number);
  const n = $derived((inputs.years as number) * m);
  const c = $derived(((inputs.face as number) * (inputs.coupon as number)) / 100 / m);
</script>

<Figures items={[["Price", f(result.price)], ["Per 100 face", f((result.price / (inputs.face as number)) * 100)]]} />
<Work hint="The present value of every payment">
  <p>Discount each coupon and the face at the yield, one {FREQ_NAME[m]} period at a time:</p>
  <span class="eq">P = Σ(t=1..N) C / (1 + y/m)^t + F / (1 + y/m)^N
  = Σ(t=1..{n}) {f(c)} / (1 + {inputs.ytm}%/{m})^t + {inputs.face} / (1 + {inputs.ytm}%/{m})^{n}
  = {f(result.price)}</span>
  <p class="aside">C is the coupon per period (face × coupon rate / m), N the number of periods, m the payments a year.</p>
</Work>
