import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import type * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

/** Local Postgres for `alchemy dev`; version matches the PlanetScale database. */
const LOCAL = { user: "erudane", password: "erudane", database: "erudane", port: 54329 } as const;
const PG_IMAGE_TAG = "18";

const placeholder = {
  name: "erudane",
  origin: {
    scheme: "postgres" as const,
    host: "runtime",
    port: 5432,
    database: "runtime",
    user: "runtime",
    password: Redacted.make(""),
  },
};

const localUrl = `postgres://${LOCAL.user}:${LOCAL.password}@localhost:${LOCAL.port}/${LOCAL.database}`;

const local = Effect.gen(function* () {
  const image = yield* Docker.RemoteImage("DbImage", { name: "postgres", tag: PG_IMAGE_TAG });
  return yield* Docker.Container("DbLocal", {
    name: "erudane-postgres",
    image,
    environment: {
      POSTGRES_DB: LOCAL.database,
      POSTGRES_USER: LOCAL.user,
      POSTGRES_PASSWORD: LOCAL.password,
    },
    ports: [{ external: LOCAL.port, internal: 5432 }],
    // Explicit: alchemy (beta.74) disconnects every network it was not told about
    // on update, bridge included, which silently drops the published port.
    networks: [{ name: "bridge" }],
    // Named volume (a Docker.Volume resource crashes in `read` without prior state in beta.74);
    // the postgres:18 image wants the mount at /var/lib/postgresql, not /data.
    volumes: [{ hostPath: "erudane-postgres-data", containerPath: "/var/lib/postgresql" }],
    start: true,
  });
});

/**
 * `bun run migrate` in this package; it retries until the database accepts
 * connections. `after` is an output of the database resource: alchemy orders
 * by output references, so this is what makes the Exec wait for it.
 */
const migrate = (url: string, after: string | Output.Output<string>) =>
  Command.Exec("DbMigrate", {
    command: "bun run migrate",
    cwd: "packages/db",
    env: { DATABASE_URL: Redacted.make(url), DB_RESOURCE: after },
    memo: { include: ["migrations/**", "migrate.ts"] },
  });

const production = Effect.gen(function* () {
  const origin = {
    scheme: "postgres" as const,
    host: yield* Config.string("DB_HOST"),
    port: yield* Config.number("DB_PORT").pipe(Config.withDefault(5432)),
    database: yield* Config.string("DB_NAME"),
    user: yield* Config.string("DB_USER"),
    password: yield* Config.redacted("DB_PASSWORD"),
  };
  const url = `postgres://${origin.user}:${Redacted.value(origin.password)}@${origin.host}:${origin.port}/${origin.database}?sslmode=verify-full`;
  return { origin, url };
});

/**
 * The Hyperdrive in front of the shared PlanetScale database. Adopted by name.
 * In dev the worker talks to the Docker Postgres instead; migrations run in both cases.
 */
export const Hyperdrive = Cloudflare.Hyperdrive.Connection(
  "Db",
  Effect.gen(function* () {
    // The props Effect also runs inside the worker (`Hyperdrive.Connect` re-evaluates
    // the resource). There the binding is what matters; the bundler folds this flag
    // to `true`, so everything below it stays out of the worker bundle.
    if (globalThis.__ALCHEMY_RUNTIME__) return placeholder;
    const name = yield* Config.string("HYPERDRIVE_NAME").pipe(Config.withDefault("erudane"));
    const dev = yield* Alchemy.ALCHEMY_DEV;
    if (dev) {
      const container = yield* local;
      yield* migrate(localUrl, container.id);
      return {
        name,
        origin: {
          scheme: "postgres" as const,
          host: "localhost",
          port: LOCAL.port,
          database: LOCAL.database,
          user: LOCAL.user,
          password: Redacted.make(LOCAL.password),
        },
        dev: {
          scheme: "postgres" as const,
          host: "localhost",
          port: LOCAL.port,
          database: LOCAL.database,
          user: LOCAL.user,
          password: Redacted.make(LOCAL.password),
          sslmode: "disable" as const,
        },
      };
    }
    const { origin, url } = yield* production;
    yield* migrate(url, origin.host);
    return {
      name,
      origin,
      mtls: { sslmode: "verify-full" as const },
      caching: { disabled: true },
      originConnectionLimit: 15,
    };
  }).pipe(Effect.orDie),
).pipe(Alchemy.RemovalPolicy.retain());
