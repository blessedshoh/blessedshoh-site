<script lang="ts">
  // A strip of labelled numbers, the same look as the pricer's summary.
  let { items }: { items: [string, string][] } = $props();
</script>

<dl class="strip">
  {#each items as [k, v] (k)}<div><dt class="k">{k}</dt><dd class="num">{v}</dd></div>{/each}
</dl>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    margin: 18px 0;
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
  }
  .strip div {
    padding: 10px 12px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  dd {
    margin: 4px 0 0;
    font-size: 17px;
  }
</style>
