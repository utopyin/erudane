import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
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

export * as Database from "./service";
