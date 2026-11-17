import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blessedshoh.dev",
  output: "server",
  // Only the D1 database is needed: no session store, no image service.
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  integrations: [svelte()],
  server: { port: 4322 },
  devToolbar: { enabled: false },
  security: { checkOrigin: true },
});
