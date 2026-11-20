<script lang="ts">
  import type { Snippet } from "svelte";
  let { children }: { children: Snippet } = $props();
</script>

<section class="card">{@render children()}</section>

<style>
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--panel);
  }
</style>
