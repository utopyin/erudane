import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Hyperdrive } from "./infra";
import { relations } from "./schema";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("Database.Error", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export type Instance = Effect.Success<
  ReturnType<typeof Drizzle.Postgres<typeof relations, never, never>>
>;

/**
 * The service is the Drizzle instance. Query Effects require `Alchemy.RuntimeContext`.
 *
 * @example
 * const db = yield* Database.Service
 * const result = yield* db.query.files.findMany();
 *  */
export class Service extends Context.Service<Service, Instance>()("@erudane/db/Database") {}

/**
 * Infrastructure as a Layer: building it registers the Hyperdrive (and, in dev,
 * the Docker Postgres + migrations) on the stack and binds it to the worker;
 * at runtime it opens one pool per request.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const connection = yield* Cloudflare.Hyperdrive.Connect(Hyperdrive);
    return yield* Drizzle.Postgres(connection.connectionString, { relations });
  }),
).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));

export * as Database from "./service";
