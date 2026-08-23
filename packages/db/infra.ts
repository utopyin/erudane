import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

/** Local Postgres for `alchemy dev`; version matches the PlanetScale database. */
const LOCAL = { user: "erudane", password: "erudane", database: "erudane", port: 54329 } as const;
const PG_IMAGE_TAG = "18";

const localUrl = `postgres://${LOCAL.user}:${LOCAL.password}@localhost:${LOCAL.port}/${LOCAL.database}`;

const local = Effect.gen(function* () {
  const image = yield* Docker.RemoteImage("DbImage", { name: "postgres", tag: PG_IMAGE_TAG });
  const data = yield* Docker.Volume("DbData");
  yield* Docker.Container("DbLocal", {
    name: "erudane-postgres",
    image,
    environment: {
      POSTGRES_DB: LOCAL.database,
      POSTGRES_USER: LOCAL.user,
      POSTGRES_PASSWORD: LOCAL.password,
    },
    ports: [{ external: LOCAL.port, internal: 5432 }],
    volumes: [{ hostPath: data.name, containerPath: "/var/lib/postgresql/data" }],
    start: true,
  });
});

/** `bun run migrate` in this package; it retries until the database accepts connections. */
const migrate = (url: string) =>
  Command.Exec("DbMigrate", {
    command: "bun run migrate",
    cwd: "packages/db",
    env: { DATABASE_URL: Redacted.make(url) },
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
    const name = yield* Config.string("HYPERDRIVE_NAME").pipe(Config.withDefault("main-eu"));
    const dev = yield* Alchemy.ALCHEMY_DEV;
    if (dev) {
      yield* local;
      yield* migrate(localUrl);
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
    yield* migrate(url);
    return {
      name,
      origin,
      mtls: { sslmode: "verify-full" as const },
      caching: { disabled: true },
      originConnectionLimit: 15,
    };
  }).pipe(Effect.orDie),
).pipe(Alchemy.RemovalPolicy.retain());
