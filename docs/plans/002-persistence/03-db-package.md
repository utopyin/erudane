# `@erudane/db`

## Prefix and table factory

```ts
// packages/db/config.ts — LEAF
export const PREFIX = "eru";
export const MIGRATIONS_TABLE = `${PREFIX}_migrations`;
```

```ts
// packages/db/table.ts — LEAF
import { pgTableCreator } from "drizzle-orm/pg-core";
import { PREFIX } from "./config.js";

/** The only table factory the schema may use: `table("threads")` → `eru_threads`, snake_case columns. */
export const table = pgTableCreator((name) => `${PREFIX}_${name}`, "snake_case");
```

`pgTableCreator(fn, casing)` is the rc API (`drizzle-orm/pg-core/table.d.ts:93`); `drizzle({ casing })` no longer exists. Column names are derived from the property names, so schema code never repeats them.

## Schema

```ts
// packages/db/schema.ts — LEAF (closure: drizzle-orm)
import { defineRelations } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { table } from "./table.js";

export const threads = table("threads", {
  id: uuid().primaryKey(),                       // client-minted or server-minted, never DEFAULT — see 05
  title: text(),
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const messageRole = pgEnum(`${PREFIX}_message_role`, ["system", "user", "assistant", "tool"]);

export const messages = table(
  "messages",
  {
    id: uuid().primaryKey(),
    threadId: uuid().notNull().references(() => threads.id, { onDelete: "cascade" }),
    seq: integer().notNull(),                    // position in the thread; assigned by the repo
    role: messageRole().notNull(),
    content: jsonb().$type<unknown>().notNull(), // Prompt.MessageEncoded (effect owns the codec, not drizzle)
    createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index().on(t.threadId, t.seq)],        // array form; the object form is deprecated in rc
);

export const relations = defineRelations({ threads, messages }, (r) => ({
  threads: { messages: r.many.messages() },
  messages: { thread: r.one.threads({ from: r.messages.threadId, to: r.threads.id }) },
}));

export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
```

Notes:

- `content` is `unknown` on purpose: the JSON codec is `Prompt.Message` from `effect/unstable/ai`, decoded in the repository (04). Keeping `effect` out of the schema keeps this module a drizzle-only leaf.
- `mode: "string"` for timestamps so rows are plain JSON-able data; the repository turns them into `DateTime` when a domain needs it.
- `pgEnum` takes the prefixed name by hand — enums are not tables, so `pgTableCreator` does not touch them.
- No `owner_id` (D21).

## Drizzle-kit

```ts
// packages/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_TABLE, PREFIX } from "./config.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  tablesFilter: [`${PREFIX}_*`],
  migrations: { table: MIGRATIONS_TABLE },
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

Scripts in `packages/db/package.json`: `generate: drizzle-kit generate`, `migrate: drizzle-kit migrate`, `studio: drizzle-kit studio`, `check: drizzle-kit check`. `DATABASE_URL` is only needed by the CLI; on the developer machine it points at the Docker database (`postgres://erudane:erudane@localhost:54329/erudane`). The stack passes its own URL to `Command.Exec` (06).

Migration folders are v3 (`migrations/20260823120000_init/{migration.sql,snapshot.json}`); the migrations table is `eru_migrations` so a second app's `acm_migrations` does not collide.

## The `Db` service

```ts
// packages/db/service.ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Hyperdrive } from "./infra.js";
import { relations } from "./schema.js";

/** What every query needs: the worker's per-request runtime (binding access, execution scope). */
export type Runtime = Alchemy.RuntimeContext;

export class DbError extends Schema.TaggedError<DbError>()("Db.Error", {
  message: Schema.String,
  cause: Schema.Defect,
}) {}

export interface Interface {
  /** Drizzle over the bound Hyperdrive. Every method returns an Effect that requires `Runtime`. */
  readonly db: Effect.Effect.Success<ReturnType<typeof Drizzle.Postgres<typeof relations>>>;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/db/Db") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const connection = yield* Cloudflare.Hyperdrive.Connect(Hyperdrive);
    const db = yield* Drizzle.Postgres(connection.connectionString, { relations });
    return { db };
  }),
).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));

export * as Db from "./service.js";
```

How it behaves in the two phases (`infrastructure-as-effects/phases.mdx`):

- **Plan/deploy** (`alchemy deploy` / `alchemy dev`): building the layer yields `Hyperdrive` (06), which registers the Connection (and in dev the container + migration) in the stack; `Hyperdrive.Connect` records a binding on the Worker. `Drizzle.Postgres` defers everything (no connection attempt without `WorkerEnvironment`).
- **Runtime**: `Connect` resolves the binding; the first query in a request builds `PgClient.layer({ url })` + `drizzle-orm/effect-postgres` `makeWithDefaults({ relations })` on the execution scope and reuses it for the rest of the request; the pool is ended when the request settles.

The exact `Interface.db` type is the one subtlety: `Drizzle.Postgres` returns a `proxyChain<EffectPgDatabase<Relations> & { $client }>`; phase 1 pins this type with `ReturnType`/`Effect.Success` as sketched, or names it explicitly if inference is unhelpful. Repository code uses `db.query.threads.findFirst({...})`, `db.insert(messages).values(...)`, `db.transaction((tx) => Effect)` — all Effects, errors `EffectDrizzleQueryError | SqlError`, mapped to `DbError` by the repo layer.

## Infra (deploy-side)

```ts
// packages/db/infra.ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

const LOCAL = { user: "erudane", password: "erudane", database: "erudane", port: 54329 } as const;
const PG_IMAGE_TAG = "18";          // = PlanetScale major; confirmed in phase 0

const local = Effect.gen(function* () {
  const image = yield* Docker.RemoteImage("DbImage", { name: "postgres", tag: PG_IMAGE_TAG });
  const data = yield* Docker.Volume("DbData");
  yield* Docker.Container("DbLocal", {
    name: "erudane-postgres",
    image,
    environment: { POSTGRES_DB: LOCAL.database, POSTGRES_USER: LOCAL.user, POSTGRES_PASSWORD: LOCAL.password },
    ports: [{ external: LOCAL.port, internal: 5432 }],
    volumes: [{ hostPath: data.name, containerPath: "/var/lib/postgresql/data" }],
    healthcheck: { cmd: ["CMD-SHELL", `pg_isready -U ${LOCAL.user} -d ${LOCAL.database}`], interval: "2 seconds", timeout: "5 seconds", retries: 15 },
    start: true,
  });
  return `postgres://${LOCAL.user}:${LOCAL.password}@localhost:${LOCAL.port}/${LOCAL.database}`;
});

const migrate = (url: string) =>
  Command.Exec("DbMigrate", {
    command: "bun run migrate",
    cwd: "packages/db",
    env: { DATABASE_URL: Redacted.make(url) },
    memo: { include: ["migrations/**", "drizzle.config.ts"] },
  });

export const Hyperdrive = Cloudflare.Hyperdrive.Connection(
  "Db",
  Effect.gen(function* () {
    const dev = yield* Alchemy.ALCHEMY_DEV;
    const origin = {
      scheme: "postgres" as const,
      host: yield* Config.string("DB_HOST"),
      port: yield* Config.number("DB_PORT").pipe(Config.withDefault(5432)),
      database: yield* Config.string("DB_NAME"),
      user: yield* Config.string("DB_USER"),
      password: yield* Config.redacted("DB_PASSWORD"),
    };
    if (dev) {
      const url = yield* local;
      yield* migrate(url);
      return {
        name: yield* Config.string("HYPERDRIVE_NAME"),
        origin,
        caching: { disabled: true },
        dev: { scheme: "postgres", host: "localhost", port: LOCAL.port, database: LOCAL.database, user: LOCAL.user, password: Redacted.make(LOCAL.password), sslmode: "disable" },
      };
    }
    yield* migrate(`postgres://${origin.user}:${Redacted.value(origin.password)}@${origin.host}:${origin.port}/${origin.database}?sslmode=verify-full`);
    return { name: yield* Config.string("HYPERDRIVE_NAME"), origin, caching: { disabled: true } };
  }),
).pipe(Alchemy.retain());
```

Points to verify in phase 1 (they are read from source but not yet executed): `Connection` accepting `Effect<Props>` (Resource.ts:351 says all resources do); `Docker.Container` healthcheck blocking `start` until healthy (else add a `pg_isready` poll in `migrate`'s command); `Command.Exec` running with the repo root as the default `cwd` base; `retain` composing on a resource Effect. In dev the `origin` Config reads still happen so `.env` must be complete — or wrap them in `Config.option` and fail only in deploy; decide when the first dev run complains.
