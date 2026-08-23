import type * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Hyperdrive } from "./infra";
import { relations } from "./schema";

/** What every query needs: the worker's per-request runtime (binding access, execution scope). */
export type Runtime = Alchemy.RuntimeContext;

export class DbError extends Schema.TaggedError<DbError>()("Db.Error", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export type Database = Effect.Success<
  ReturnType<typeof Drizzle.Postgres<typeof relations, never, never>>
>;

export interface Interface {
  /** Drizzle over the bound Hyperdrive. Query Effects require `Runtime`. */
  readonly db: Database;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/db/Db") {}

/**
 * Infrastructure as a Layer: building it registers the Hyperdrive (and, in dev,
 * the Docker Postgres + migrations) on the stack and binds it to the worker;
 * at runtime it opens one pool per request.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const connection = yield* Cloudflare.Hyperdrive.Connect(Hyperdrive);
    const db = yield* Drizzle.Postgres(connection.connectionString, { relations });
    return { db };
  }),
).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));

export * as Db from "./service";
