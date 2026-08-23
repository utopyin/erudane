# Infra and runtimes

## The API worker becomes Effect-form

`Db.layer` is an Effect Layer that yields resources and bindings while it builds, so the API worker is the Effect-form `Cloudflare.Worker<Api>()(id, props, init)` (`Cloudflare/Workers/Worker.ts:1615`): alchemy evaluates its init at plan time **and** at runtime.

```ts
// apps/api/src/index.ts
import { Chat } from "@erudane/chat/service";
import { Run } from "@erudane/chat/run";
import { ThreadRepo } from "@erudane/chat/threads";
import { Db } from "@erudane/db/service";
import { Http } from "@erudane/http";
import { layer as registry } from "@erudane/http/chat/registry";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as Model from "./model.js";

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  { main: import.meta.url, compatibility: { flags: ["nodejs_compat"] } },
  Effect.gen(function* () {
    const db = yield* Db.Service;                       // init: binds Hyperdrive (plan) / resolves it (runtime)
    const model = yield* Model.layer;                   // init: Config reads (auto-bound as secrets at plan time)

    const app = Http.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(Chat.layer, Run.layer)),
      Layer.provideMerge(ThreadRepo.layer),
      Layer.provide(Layer.mergeAll(model, registry, Layer.succeed(Db.Service, db))),
    );

    return { fetch: yield* HttpRouter.toHttpEffect(app) };   // HttpRouter.ts:617
  }).pipe(Effect.provide(Db.layer)),
) {}
```

- `toHttpEffect` builds the router layer once at boot and yields the per-request `HttpEffect`; route requirements that are not satisfied by the layer (`Db.Runtime` = `Alchemy.RuntimeContext`, `Scope`, `HttpServerRequest`) flow into `fetch`'s requirements, which the worker bridge provides per request.
- `Layer.succeed(Db.Service, db)`: the service was already built by `Effect.provide(Db.layer)` on the init; re-wrapping it avoids building the layer twice (the resource yields are idempotent, but one is enough).
- `Model.layer` reads `Config.redacted("OPENAI_API_KEY").pipe(Config.withDefault(Redacted.make("")))`, `Config.string("OPENAI_MODEL").pipe(Config.withDefault("gpt-4.1-mini"))`, `Config.redacted("CHATGPT_OAUTH").pipe(Config.withDefault(Redacted.make("")))`, `Config.string("CHATGPT_MODEL")…`. Any `Config` read during init is intercepted at plan time and bound to the Worker as a secret; at runtime the same read resolves from the env through `WorkerConfigProvider` (`Runtime.ts:85-126`, `Workers/ConfigProvider.ts`).
- `alchemy.run.ts` imports the class: `import Api from "./apps/api/src/index.js"`; `Website` keeps `env: { API: Api }` (the class is the resource; verify the env binding accepts the class form — `examples/cloudflare-tanstack-rpc-drizzle` binds a class worker the same way).

## `alchemy.run.ts`

```ts
providers: Layer.mergeAll(Cloudflare.providers(), Docker.providers(), Command.providers()),
```

ChatGPT dev credentials (001 D11) go through Config: before `yield* Api` the stack provides a `ConfigProvider` layered over the default one with `CHATGPT_OAUTH` = the JSON from `ChatGpt.fresh` when `ALCHEMY_DEV` (`ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ CHATGPT_OAUTH }))` — `ConfigProvider.ts:704`, which composes onto the current provider with `orElse`). The init's `Config.redacted("CHATGPT_OAUTH")` read then sees it at plan time and binds it. If the interceptor turns out to read only the process-env provider, fall back to `process.env.CHATGPT_OAUTH = …` before yielding the worker; phase 2 decides.

Stack outputs add `hyperdriveId: hyperdrive.hyperdriveId` (from `Hyperdrive` in `@erudane/db/infra`) so the first deploy visibly prints `b08010000ce747df8ee0ff4f415884e5` — the proof that adoption, not creation, happened.

## Hyperdrive adoption checklist (phase 0, manual)

1. Done: config `main-eu` → `.env.production.example` carries name, host, port, database, user. Copy to `.env.production`.
2. `DB_PASSWORD`: the password of `pscale_api_gq62g6daakjh.qir2334nbie2` (the role the PlanetScale integration created). If it is not retrievable, create a dedicated role (`pg_read_all_data`, `pg_write_all_data`), set `DB_USER`/`DB_PASSWORD` to it, and the first deploy rotates the Hyperdrive origin.
3. Done: Postgres 18 → `PG_IMAGE_TAG = "18"`.
4. `alchemy deploy` once with the new stack: expect `Cloudflare.Hyperdrive.Connection "Db"` to **adopt** `main-eu` (the config was made by the PlanetScale integration — if Cloudflare rejects the update because of `integration_name`, create an alchemy-owned config on the same origin), `Command.Exec "DbMigrate"` to run against PlanetScale, and the Worker to receive the `HYPERDRIVE` binding. The Hyperdrive is `retain`ed — `alchemy destroy` leaves it alone.

Hyperdrive specifics honoured: transaction-mode pooling (no session state across queries — Drizzle's `db.transaction` is fine, `SET` is not), `caching: { disabled: true }` (D17), statement timeout 60 s, direct port 5432 with `sslmode=verify-full` (`developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/planetscale-postgres/`).

## Local development

`bun run dev` now:

1. Pulls `postgres:18` if missing, creates the `DbData` volume and starts `erudane-postgres` on `localhost:54329` (idempotent across restarts; data persists).
2. Runs `bun run migrate` in `packages/db` with `DATABASE_URL` pointing at it (memoised on `migrations/**` — re-runs only when a migration is added).
3. Registers the local Hyperdrive with the `dev` origin; the worker's `connectionString` is `postgres://erudane:erudane@localhost:54329/erudane?sslmode=disable`.

The developer needs Docker running. `bun run db:generate` after editing `schema.ts`; `bun run db:studio` to look at rows. `.env` holds only `DATABASE_URL` for those CLI commands; the stack computes its own URL and reads no `DB_*` in dev (the origin Config reads sit on the deploy branch of `Db.infra`).

## Deploy

`bun run deploy` (`alchemy deploy --env-file .env.production`) → migrations run against PlanetScale before the worker is updated (the `Exec` is yielded inside the Connection props, and the Connection is yielded by `Db.layer` inside the worker's init, so the order is Exec → Connection → Worker). A failing migration fails the deploy before any traffic hits the new code.
