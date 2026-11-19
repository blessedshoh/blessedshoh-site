<script lang="ts">
  // Placeholder until Task 10 builds this area.
  import type { BondInput } from "../lib/types.ts";
  let { bond = $bindable() }: { bond: BondInput; [key: string]: unknown } = $props();
</script>

<p class="note">This area is being built ({bond.coupon}%).</p>
