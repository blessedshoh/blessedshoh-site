<script lang="ts">
  // Placeholder until Task 11 builds this area.
  import type { BondInput, HedgeInput } from "../lib/types.ts";
  let { bond = $bindable(), hedge = $bindable() }: { bond: BondInput; hedge: HedgeInput; [key: string]: unknown } = $props();
</script>

<p class="note">This area is being built ({bond.coupon}%, {hedge.mode}).</p>
