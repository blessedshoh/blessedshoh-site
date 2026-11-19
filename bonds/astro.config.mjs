import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://bonds.blessedshoh.dev",
  // The page is rendered per visit so it can read the hub's settings: the admin's
  // feature switches, the project list for the header, and the stored Treasury curve.
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    // In development, share the hub's local database so dashboard edits show here too.
    persistState: { path: "../hub/.wrangler/state" },
  }),
  session: false,
  integrations: [svelte()],
  server: { port: 4323 },
  devToolbar: { enabled: false },
});
