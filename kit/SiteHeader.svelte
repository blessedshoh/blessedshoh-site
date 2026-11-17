<script>
  import ThemeSwitch from "./ThemeSwitch.svelte";

  // links: [{ title, url, current? }]. Later this list comes from the hub's project registry.
  let { home = "https://blessedshoh.dev", section = "", links = [], theme = "paper" } = $props();
</script>

<header>
  <div class="wrap bar">
    <a class="wordmark" href={home}>blessedshoh</a>
    {#if section}<span class="section k">{section}</span>{/if}
    <nav aria-label="Projects">
      {#each links as link}
        <a href={link.url} aria-current={link.current ? "page" : undefined}>{link.title}</a>
      {/each}
    </nav>
    <ThemeSwitch initial={theme} />
  </div>
</header>

<style>
  header {
    border-bottom: 1px solid var(--line);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px 20px;
    flex-wrap: wrap;
    padding-top: 13px;
    padding-bottom: 13px;
  }
  .wordmark {
    font: 600 20px/1 var(--serif);
    letter-spacing: -0.01em;
    text-decoration: none;
  }
  .section {
    color: var(--accent);
    padding-left: 12px;
    border-left: 1px solid var(--line);
  }
  nav {
    display: flex;
    gap: 20px;
    margin-left: auto;
    font-size: 14px;
    color: var(--muted);
  }
  nav a {
    text-decoration: none;
  }
  nav a:hover,
  nav a[aria-current="page"] {
    color: var(--ink);
  }
  @media (max-width: 760px) {
    .bar {
      gap: 8px 12px;
    }
    nav {
      display: none;
    }
    .bar > :global(.seg) {
      margin-left: auto;
    }
    .bar > :global(.seg button) {
      padding: 8px 8px;
      letter-spacing: 0.05em;
    }
  }
</style>
