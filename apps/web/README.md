# @erudane/web

The Erudane TanStack Start application, deployed to Cloudflare through Alchemy.

From the repository root:

```bash
bun install
bun run dev
```

`bun run dev` starts the Alchemy-managed Vite development server with Cloudflare bindings. To work on the frontend without those bindings, run `bun run dev` from this directory.

Build and type-check the workspace with:

```bash
bun run build
bun run check:types
```
