<script lang="ts">
  // "Show your work": the model's formula with this run's inputs and results in it.
  import type { Snippet } from "svelte";
  import { track } from "../lib/track.ts";

  let { hint, children }: { hint: string; children: Snippet } = $props();
</script>

<details class="work" ontoggle={(e) => e.currentTarget.open && track("work")}>
  <summary><span class="title">Show your work</span> <span class="hint">{hint}</span></summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  .work {
    margin-top: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  summary {
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    gap: 12px;
    align-items: baseline;
  }
  .title {
    font: 500 11px/1.4 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hint {
    font-size: 13px;
    color: var(--muted);
  }
  .body {
    padding: 0 16px 14px;
    font-size: 14px;
    color: var(--soft);
  }
  .body :global(code),
  .body :global(.eq) {
    font: 400 12.5px var(--mono);
    color: var(--ink);
  }
  .body :global(.eq) {
    display: block;
    overflow-x: auto;
    white-space: pre;
    padding: 8px 0;
  }
  .body :global(.aside) {
    font-size: 13px;
    color: var(--muted);
  }
</style>
