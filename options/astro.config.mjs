import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://options.blessedshoh.dev",
  integrations: [svelte()],
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
