<script>
  import { onMount, untrack } from "svelte";
  import { currentTheme, setTheme } from "./theme.js";

  // `initial` is what the server renders. The real value is read once the page is live.
  let { initial = "paper" } = $props();
  let theme = $state(untrack(() => initial));

  onMount(() => {
    theme = currentTheme();
    const sync = (event) => (theme = event.detail);
    window.addEventListener("bs-theme", sync);
    return () => window.removeEventListener("bs-theme", sync);
  });
</script>

<span class="seg" role="group" aria-label="Colour mode">
  <button type="button" aria-pressed={theme === "paper"} onclick={() => setTheme("paper")}>Paper</button>
  <button type="button" aria-pressed={theme === "terminal"} onclick={() => setTheme("terminal")}>Terminal</button>
</span>
