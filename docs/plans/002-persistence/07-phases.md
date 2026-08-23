# Phases

Each phase ends green on `bun run check` and the named verification; one commit per phase (`feat(db): …`, `feat(chat): …`).

## Phase 0 — Inputs and scaffolding

- Hyperdrive checklist from [06](./06-infra.md): name/origin/Postgres 18 are known and in `.env.example`; only `DB_PASSWORD` remains (filled in `.env.production` by hand).
- Catalog entries (`drizzle-orm`, `drizzle-kit`, `@effect/sql-pg`, `pg`, `@types/pg`); `packages/db` with `package.json`, `tsconfig.json`, `config.ts`, `table.ts`, empty `schema.ts`; root `db:*` scripts; `.env.example`.
- `docs/plans/002-persistence` committed (this).

Verify: `bun install`, `bun run check` green; `bunx drizzle-kit --help` runs from `packages/db`.

## Phase 1 — Schema, migrations, `Db` service, infra

`schema.ts`, `drizzle.config.ts`, `bun run db:generate` → first migration folder committed; `service.ts`, `infra.ts`.

Verify: `docker run` a throwaway `postgres:18`, `DATABASE_URL=… bun run db:migrate` creates `eru_threads`, `eru_messages`, `eru_message_role`, `eru_migrations` and nothing else; `psql -c '\dt'` shows only `eru_*`. Type-level: `Db.layer` requirements are exactly what `Effect.provide` in a worker init can satisfy (no stray `Scope`/`RuntimeContext` at layer level).

## Phase 2 — Effect-form worker + dev database

`apps/api/src/index.ts` rewrite, `model.ts` to `Config`, delete `env.ts`/`runtime.ts`, `alchemy.run.ts` providers + ConfigProvider override, `Website` binding check.

Verify: `bun run dev` starts the container, applies migrations, serves `/health`; ChatGPT-sub inference still works (001 D11 path through `Config`); a scratch route or `bun repl` against `Db.Service` runs `db.select().from(threads)` through the local Hyperdrive passthrough. Then `bun run deploy`: adoption of `7986575e…` confirmed in the plan output and in stack outputs; `/health` on production.

## Phase 3 — Domain: `ThreadRepo` + `Run`

`types.ts`/`errors.ts` additions, `threads.ts` (drizzle + memory), `run.ts`, `ChatEvent.StepStart.messageId`.

Verify: scratch script with `ThreadRepo.memory` + the fake model from 001 phase 1: a run appends `[user, assistant]`, a tool run appends `[user, assistant, tool, assistant]`, `messages()` returns them in `seq` order, a run on an unknown thread fails with `ThreadNotFound`. Against the dev database: same script with `ThreadRepo.layer` inside the worker (temporary route), rows visible in `db:studio`.

## Phase 4 — HTTP: run, hydrate, threads

`agui.ts` changes, `ui.ts`, `route.ts` GET/POST, `threads/route.ts`, `index.ts`.

Verify: `curl -N -X POST /chat` twice with the same `threadId` — the second answer proves history was loaded server-side (ask "what did I just say?"); `curl /chat?threadId=` returns the two exchanges as `UIMessage`s with the same ids the SSE used; `curl /threads` lists the thread; 404 for an unknown thread; 400 for a non-UUID `threadId`.

## Phase 5 — Web

Routes, sidebar, `persistence: true`.

Verify in the browser: new chat → URL becomes `/chat/<uuid>` → send → reload → transcript repainted from the server with no duplicate bubble, tool cards and reasoning rendered from stored parts → open the same URL in another browser → same transcript → sidebar lists it. Deploy and repeat on production (PlanetScale through Hyperdrive).

## Explicitly deferred (D22)

Resume/`activeRun`, runs table + usage, titles, ownership (003 auth), PR-branch databases, partial-run persistence on stop.
