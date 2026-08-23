# 002 — Persistence

Threads and messages survive a reload. The server becomes the authority on a conversation: the client sends one new message per run, the API loads the history, streams the answer, and stores what the model produced. `useChat({ persistence: true, threadId })` then hydrates from the server on mount.

The slice also lays the database foundation every later domain will use: one shared Postgres (PlanetScale, reached through Hyperdrive in production, Docker locally), Drizzle 1.0 rc as the query layer, a tier-1 `@erudane/db` package that carries its own infrastructure as an Effect Layer, and **repository services** in each domain so that persistence is swappable (Drizzle by default, in-memory for tests and scratch scripts).

Read in order:

| Doc                                          | What it fixes                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [01-decisions.md](./01-decisions.md)         | Decisions D12–D22 and what was verified in `repos/alchemy`, the installed drizzle rc.5, TanStack AI 0.48 |
| [02-packages.md](./02-packages.md)           | Package map, every file, exports, closures                                                    |
| [03-db-package.md](./03-db-package.md)       | `@erudane/db`: schema + prefix, Drizzle config/migrations, the `Db` service and its infra Layer |
| [04-chat-persistence.md](./04-chat-persistence.md) | `@erudane/chat`: `ThreadRepo` (drizzle + memory layers), `Run` orchestration around `Chat.stream` |
| [05-http-and-web.md](./05-http-and-web.md)   | Routes (`POST /chat`, `GET /chat?threadId`, `GET /threads`), Prompt → UIMessage codec, web pages |
| [06-infra.md](./06-infra.md)                 | Hyperdrive adoption, PlanetScale origin, local Postgres in Docker, migrations at deploy, the Effect-form API worker |
| [07-phases.md](./07-phases.md)               | Implementation order, verification, deferred                                                  |

Related: [001-chat](../001-chat/README.md) (the seams this plan builds on), [docs/architecture/CONTEXT.md](../../architecture/CONTEXT.md).

## The shape in one picture

```
apps/web                                  apps/api  (Effect-form Cloudflare.Worker, nodejs_compat)
┌──────────────────────────────┐          ┌───────────────────────────────────────────────────┐
│ /chat        → mints threadId│          │ init:                                             │
│ /chat/$id    useChat({       │  env.API │   fetch = HttpRouter.toHttpEffect(                │
│   persistence: true,         │ ───────▶ │     Http.layer                                    │
│   threadId })                │          │       .provideMerge(Chat.layer, Run.layer)        │
│ /api/chat    ANY → /chat     │          │       .provide(ThreadRepo.layer)   ← domains/chat │
│ /api/threads GET → /threads  │          │       .provide(Db.layer)           ← packages/db  │
└──────────────────────────────┘          │       .provide(Model.layer, registry))            │
                                          └───────────────────────────────────────────────────┘
                                                   │ Db.layer yields (at plan time) the Hyperdrive
                                                   │ Connection, the dev Docker Postgres and the
                                                   │ migration Exec; (at runtime) Hyperdrive.Connect
                                                   ▼
                                   Hyperdrive ──▶ PlanetScale Postgres (prod)
                                   dev origin ──▶ docker postgres:18 (alchemy dev)
```

Tables are prefixed `eru_` (`eru_threads`, `eru_messages`) because the database is shared by several apps; a second app uses its own 3-letter prefix and its own `tablesFilter`.
