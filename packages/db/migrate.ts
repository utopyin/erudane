import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { MIGRATIONS_TABLE } from "./config";

/**
 * Applies `./migrations` to `DATABASE_URL`, tracking them in
 * `public.<prefix>_migrations` with drizzle's own table layout. Drizzle's
 * migrator is not used because it `CREATE SCHEMA`s unconditionally, which
 * the least-privilege app role is not allowed to do. Retries the connection
 * for a while so it can run right after the dev container starts.
 */
const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const table = sql(MIGRATIONS_TABLE);
  const local = readMigrationFiles({
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });

  yield* sql`CREATE TABLE IF NOT EXISTS ${table} (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint,
    name text,
    applied_at timestamp with time zone DEFAULT now()
  )`;
  const applied = yield* sql<{ hash: string }>`SELECT hash FROM ${table}`;
  const done = new Set(applied.map((row) => row.hash));
  const pending = local.filter((migration) => !done.has(migration.hash));

  yield* sql.withTransaction(
    Effect.forEach(pending, (migration) =>
      Effect.gen(function* () {
        for (const statement of migration.sql) yield* sql.unsafe(statement);
        yield* sql`INSERT INTO ${table} (hash, created_at, name)
          VALUES (${migration.hash}, ${migration.folderMillis}, ${migration.name})`;
        yield* Console.log(`applied ${migration.name}`);
      }),
    ),
  );
  yield* Console.log(`migrations: ${pending.length} applied, ${done.size} already present`);
}).pipe(
  Effect.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
  Effect.retry({ schedule: Schedule.spaced("1 second"), times: 30 }),
);

BunRuntime.runMain(program);
