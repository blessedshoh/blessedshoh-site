<script lang="ts">
  // Placeholder until Task 12 builds this area.
  import type { BasicsInput } from "../lib/types.ts";
  let { basics = $bindable() }: { basics: BasicsInput | null; [key: string]: unknown } = $props();
</script>

<p class="note">This area is being built{basics ? ` (${basics.model})` : ""}.</p>
