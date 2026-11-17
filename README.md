# blessedshoh site

The web side of blessedshoh.dev. Every page shares one look, "Paper and Terminal": a light mode for reading and a dark mode for tools.

| Folder | What it is | Address |
|---|---|---|
| `kit/` | Shared colours, type, theme switch and site header | used by every site |
| `options/` | The options risk tool (Astro + Svelte, static files) | options.blessedshoh.dev |
| `reference/` | The design sample the look came from | not published |

All option maths happens in the Python API (`quant-core`, served at api.blessedshoh.dev). The browser only reads and interpolates the grid the API returns.

## Work on it locally

```
pnpm install
pnpm --dir options dev          # http://localhost:4321
```

The tool calls a local API in development. Start it from `quant-core` with `python api/dev.py`.

## Check it

```
pnpm --dir options test         # logic tests, including parity with the Python grid reader
pnpm --dir options check        # type check
pnpm --dir options build
```

## Publish it

The options tool is a static-assets Worker on Cloudflare. `wrangler.jsonc` attaches it to options.blessedshoh.dev, and Cloudflare creates that DNS record and certificate itself.

```
pnpm --dir options exec wrangler login      # once per machine
pnpm --dir options run deploy
```

When the default example in `options/src/data/settings.json` changes, store its prices again before publishing, with the API running:

```
pnpm --dir options default-grid
```
