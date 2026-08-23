# Decisions

Numbering continues from 001 (D1–D11). Each entry: the decision, why, what was verified and where.

## D12 — Drizzle 1.0 rc.5; `repos/drizzle` now tracks the `rc5` branch

`repos/drizzle` was the `main` branch (`drizzle-orm 0.45.3`: no `defineRelations`, RQB v1, journal-style migrations) and has been re-vendored from upstream branch `rc5` (`1.0.0-rc.5`, commit `52074d19ff`); `beta` is still rc.4. npm: dist-tag `rc5` = `drizzle-orm@1.0.0-rc.5-169397b`, `drizzle-kit@1.0.0-rc.5-ab785fc`. Alchemy pins `drizzle-orm@1.0.0-rc.5-ab785fc` / `drizzle-kit@1.0.0-rc.5-ab785fc` as the only release compatible with `effect >= 4.0.0-rc.110` (`repos/alchemy/pnpm-workspace.yaml:164`, `website/.../cloudflare/data/drizzle.mdx`). We pin **`1.0.0-rc.5-ab785fc`** for both to match alchemy's peer range exactly.

Verified against the installed rc.5 (scratchpad install, `tsc` + `drizzle-kit generate` run) and now readable in `repos/drizzle/drizzle-orm/src/{pg-core,relations.ts,effect-postgres,effect-core}`:

- `pgTable(name, columns, (t) => [index(...), ...])` — array third arg; object form deprecated.
- `drizzle({ casing })` is gone; `pgTableCreator(fn, 'snake_case')` still exists (`pg-core/table.d.ts:93`) and is the one helper that does prefix + casing together.
- Relations: `defineRelations(schema, (r) => ({...}))`; `db.query.x.findMany({ where: { col: value }, with })` with object-style `where`.
- Migrations folder is v3: `<out>/<YYYYMMDDHHmmss>_<name>/{migration.sql,snapshot.json}`, no journal.
- Effect integration is bundled: `drizzle-orm/effect-postgres` (`make`/`makeWithDefaults` over `@effect/sql-pg` `PgClient`), every query is an `Effect`, errors `EffectDrizzleQueryError` / `SqlError`, `drizzle-orm/effect-postgres/migrator`. Peer `effect >= 4.0.0-beta.105` — compatible with our rc.111.
- Either `rc.5` hash works at the API level; the alchemy pin wins because `alchemy/Drizzle/Postgres` imports `drizzle-orm/effect-postgres` types.

Swap the catalog entry, not code, if rc.6 lands before implementation.

## D13 — `@erudane/db` is a tier-1 package that owns schema, migrations and the `Db` service

`packages/db` contains the Drizzle schema for the whole database (every domain's tables), the relations, the drizzle-kit config, the generated migrations, and the `Db` Effect service with its default Layer. It depends on `drizzle-orm`, `@effect/sql-pg`, `alchemy` and `effect`.

Why one package and not tables-per-domain: drizzle-kit wants a single schema entry and one linear migration history per database; relations cross domains; the prefix and casing policy must be applied in one place. Tier-1 is allowed to know the **shape** of a concept (CONTEXT.md membership test) and that is all a table definition is. Behaviour over those tables (repositories) lives in the owning domain (D15).

Sub-paths are leaf submodules: `@erudane/db/schema` (tables + relations; closure `drizzle-orm` only) is importable by anything; `@erudane/db/service` pulls alchemy + sql-pg and is imported only by repositories and the runtime.

## D14 — Table prefix at the config level: `eru_`

A single constant `PREFIX = "eru"` in `packages/db/config.ts` feeds both `pgTableCreator((name) => \`${PREFIX}_${name}\`, "snake_case")` (`packages/db/table.ts`, the only table factory the schema may use) and `drizzle.config.ts` `tablesFilter: [\`${PREFIX}_*\`]`. Another app sharing the database (`acm`) gets its own `packages/db`-equivalent with its own prefix; `tablesFilter` keeps `push`/`pull`/`generate` blind to the other app's tables. Verified: `drizzle-kit generate` emits `CREATE TABLE "eru_threads"` and carries the prefix into FK/index names; `schemaFilter` now defaults to all schemas in rc (irrelevant here, we stay in `public`).

Rejected: `pgSchema("eru")` per app — cleaner isolation, but Hyperdrive caching/`search_path` and PlanetScale role grants get fiddlier, and the user asked for prefixed table names.

## D15 — Persistence is modelled as repository services owned by their domain

`domains/chat/threads.ts` declares `ThreadRepo.Service` (`Context.Service`) with an interface in domain terms (`Thread`, `Prompt.Message`, `Option`, typed `RepoError`/`ThreadNotFound`) and two layers: `layer` (Drizzle, requires `Db.Service`) and `memory` (a `Ref`-backed map, requires nothing). Domain logic (`Run`, later summaries/grading) depends on the interface only. Tier-3/4 never touch Drizzle directly.

Why: this is what makes phase-1 verification with a fake model possible without a database, keeps Drizzle types out of the domain's public surface, and gives one place to translate `EffectDrizzleQueryError | SqlError` into domain errors.

## D16 — Infrastructure as Layer: `Db.layer` carries the Hyperdrive, the dev database and the migrations

Alchemy's pattern (`website/.../infrastructure-as-effects/layers.mdx`): a `Layer.effect(Tag, …)` that yields resources and bindings inside its build. `Db.layer` yields `Cloudflare.Hyperdrive.Connection("Db", props)` — whose props Effect also yields, in `alchemy dev` only, a `Docker.Container` running Postgres and a `Command.Exec` applying migrations — then `Cloudflare.Hyperdrive.Connect(connection)` and `Drizzle.Postgres(conn.connectionString, { relations })` (`alchemy/Drizzle/Postgres`, `packages/alchemy/src/Drizzle/Postgres.ts:49`). Providing `Db.layer` to a Worker's init is what binds the Hyperdrive to that Worker and, on the next deploy, reconciles the resources.

Consequences, all verified in source:

- The API worker must be the **Effect-form** `Cloudflare.Worker<Api>()("Api", props, init)` with `fetch: yield* HttpRouter.toHttpEffect(appLayer)` (`HttpRouter.ts:617`; alchemy `cloudflare/apis/effect-http-api.mdx`). The plain `export default { fetch }` + `runtime(env)` form from 001 goes away (06-infra).
- `Drizzle.Postgres` memoizes the pool **per execution scope** (`Runtime/ExecutionMemo.ts`): one pool per request, closed when the request settles. This is the only legal shape on workerd (sockets are IoContext-pinned) and matches Cloudflare's "new client per request" guidance.
- Queries carry `Alchemy.RuntimeContext` in their requirements (the connection string is read from the binding at request time). `@erudane/db` re-exports it as `Db.Runtime`; repository interfaces use it; `toHttpEffect` threads it to `fetch`, which the worker bridge provides. The memory layer simply doesn't need it.
- `nodejs_compat` is required for `pg` (`compatibility: { flags: ["nodejs_compat"] }`, `Worker.ts:799`).

## D17 — The existing Hyperdrive is adopted by name; its origin is the PlanetScale role, supplied through `.env`

Alchemy has no "bind Hyperdrive by id" form: `Cloudflare.Hyperdrive.Connection.read` looks up by **name** and silently adopts a match (`Cloudflare/Hyperdrive/Connection.ts:222-262`), then `reconcile` re-puts the origin (the API never returns the password, so we must supply it). The config is `main-eu` (id `b08010000ce747df8ee0ff4f415884e5`, created from the PlanetScale integration: origin `eu-central-1.pg.psdb.cloud:5432/postgres`, user `pscale_api_gq62g6daakjh.qir2334nbie2`, caching already disabled, `origin_connection_limit: 15`). Those values are in `.env.example`; only `DB_PASSWORD` is filled by hand. After the first deploy alchemy's state holds `hyperdriveId = b0801000…`. The props mirror the existing config exactly (`originConnectionLimit: 15`, `caching: { disabled: true }`) so adoption is a no-op update.

Guard rails: `Alchemy.retain()` wraps the Connection so `alchemy destroy` does not delete a config we did not create; `caching: { disabled: true }` because chat reads must not be served stale (Hyperdrive's query cache is not invalidated on writes, default 60 s). Origin port is the direct **5432** (Hyperdrive already pools in transaction mode; stacking PSBouncer on 6432 adds nothing) with `sslmode=verify-full`. Role: a dedicated PlanetScale role with `pg_read_all_data`/`pg_write_all_data`, not the default admin role.

Not adopted: alchemy's `Planetscale.PostgresDatabase/Branch/Role` resources. They would let alchemy own the database and apply migrations natively, but the database already exists and the user supplied the Hyperdrive directly. Revisit when we want PR branches.

## D18 — Local development: Postgres 18 in Docker, started by `alchemy dev`, reached through the Hyperdrive `dev` origin

In `alchemy dev` the Connection provider is local: no API call, and the worker's `env.HYPERDRIVE.connectionString` is a passthrough to the `dev` origin (`Hyperdrive/ConnectBinding.ts:52-89`, `cloudflare/local-development.mdx`). We point `dev` at a `Docker.Container` (`Docker/Container.ts`, example `examples/docker-postgres/alchemy.run.ts`) created only when `Alchemy.ALCHEMY_DEV` is true — Docker providers are single-mode, so the gate is ours. Image `postgres:18` — the PlanetScale database runs 18 (confirmed); PlanetScale offers 17.11 and 18.6 (`planetscale.com/docs/postgres/cluster-configuration/versions`). Port `54329` on the host to avoid colliding with a system Postgres; a named volume keeps data across restarts.

Rejected: a `docker-compose.yml` the developer runs by hand (works, but then the version pin lives outside the stack and "ensure one is running" becomes documentation instead of code). Also rejected: `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_*` — that is wrangler's mechanism, alchemy's is the `dev` prop.

## D19 — Migrations are generated explicitly and applied by the stack

`bun run db:generate` (drizzle-kit) produces v3 migration folders under `packages/db/migrations/`, committed and reviewed. Applying happens inside `Db.layer`'s resource build as `Command.Exec("DbMigrate", { command: "bun run db:migrate", cwd: "packages/db", env: { DATABASE_URL }, memo: { include: ["migrations/**"] } })` (`Command/Exec.ts`) — dev runs it against the Docker database after the container is healthy, deploy runs it against the PlanetScale origin directly (not through Hyperdrive) before the Worker is put. `bun run db:migrate` is `drizzle-kit migrate`, which reads `DATABASE_URL` through `drizzle.config.ts`.

Rejected: `Drizzle.Schema` (auto-generates migrations at deploy) — generating schema diffs inside a deploy is how an unreviewed `DROP COLUMN` ships; it also needs a `Planetscale.*`/`Neon.*` database resource to apply them. Rejected: running the Effect migrator from the worker at startup — no filesystem in the isolate, and migrations are not a request-path concern.

## D20 — Stored form is Effect AI's `Prompt.Message`; the server is the authority on the transcript

`eru_messages.content` is the JSON encoding of `Prompt.Message` (`Schema.Codec<Message, MessageEncoded>`, `unstable/ai/Prompt.ts:1776`): user/assistant/tool messages with their parts (text, reasoning, tool-call, tool-result, files). This is the form the chat domain already speaks (`ChatInput.messages`), `Prompt.fromResponseParts` produces it from a finished step, and it is entrypoint-neutral (D1).

Each run persists: the incoming user message, then after the stream completes, one assistant message and one tool message per step (what `Prompt.fromResponseParts` yields). The request's `messages` array is still sent whole by the client (TanStack always does) but the server only takes the **last user message** from it; history comes from the repository. That is what makes "same thread on another device" correct.

Tier 3 converts stored messages to TanStack `UIMessage`s for hydration (`GET /chat?threadId=`, the `hydrate` handler `fetchServerSentEvents` already exposes — `ai-client/connection-adapters.js:300,622`; response shape `{ messages, activeRun, interrupts }`, `connection-adapters.d.ts:173`). Message ids must be stable across hydration and streaming so a reload does not duplicate bubbles: we use the stored row id as the AG-UI message id, which means the AG-UI codec gets the ids from the `Run` events instead of deriving `${runId}-${step}` (05).

## D21 — Threads have no owner yet

No auth exists, so `eru_threads` has no `owner_id` and any thread is readable by whoever knows its UUID. The column and the `where` clauses are added by the auth plan (003); repositories take a `threadId` only, so that change is local to the repository layers and the route guards. This is stated in the README as a known gap, not hidden.

## D22 — Deferred, with the seam named

- **Resume / joinRun / activeRun**: hydration returns `activeRun: null`. Re-attaching to an in-flight run needs a durable event log (Durable Object or KV) — the codec already emits per-run ids, so the seam is `Run.Service` emitting into a sink as well as the response.
- **Runs table / usage accounting**: `ChatEvent.StepEnd` carries `usage`; storing it per run is a new `eru_runs` table and one more repository method. Not needed for reload-safe chat.
- **Thread titles**: `title` column exists (nullable); filled by a later background job (the first use of a non-HTTP entrypoint).
- **Sidebar pagination / search**: `ThreadRepo.list` takes a `limit`; cursors later.
- **Ownership** (D21), **PR-branch databases** (D17), **`scripts/dep-map.ts`** (001 D9).
