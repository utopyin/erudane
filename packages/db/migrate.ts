import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { MIGRATIONS_TABLE } from "./config";

/**
 * Applies `./migrations` to `DATABASE_URL`. Retries the connection for a while
 * so it can run right after the dev container starts.
 */
const program = Effect.gen(function* () {
  const db = yield* PgDrizzle.makeWithDefaults();
  yield* migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
    migrationsTable: MIGRATIONS_TABLE,
  });
  yield* Console.log("migrations applied");
}).pipe(
  Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
  Effect.retry({ schedule: Schedule.spaced("1 second"), times: 30 }),
);

BunRuntime.runMain(program);
