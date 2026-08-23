# Erudane

Erudane is a learning platform that empowers you to learn anything.

## Layout

Four tiers, four directories — see [docs/architecture/CONTEXT.md](docs/architecture/CONTEXT.md):

| Directory      | Packages                                                 |
| -------------- | -------------------------------------------------------- |
| `packages/`    | mechanism and shapes (none yet)                          |
| `domains/`     | `@erudane/chat`                                          |
| `entrypoints/` | `@erudane/http` — the HTTP API router                    |
| `apps/`        | `@erudane/api` (Worker), `@erudane/web` (TanStack Start) |

Plans live in `docs/plans/`; the first slice is [001-chat](docs/plans/001-chat/README.md).

## Run

```bash
bun install
cp .env.example .env   # set OPENAI_API_KEY
bun run dev            # alchemy dev: web on :1337, api on :1338
```

`bun run check` lints, formats and type-checks every workspace. `bun run deploy` / `bun run destroy` manage the Cloudflare stack through Alchemy (`CLOUDFLARE_API_TOKEN` or `alchemy login`).
