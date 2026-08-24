import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Hyperdrive } from "./connection";
import { relations } from "./schema";
import { Service } from "./service";

/**
 * Cloudflare Hyperdrive implementation of Database. Building the layer registers
 * the Hyperdrive resource and Worker binding. Drizzle defers the request-scoped
 * connection pool to Alchemy's runtime context.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const connection = yield* Cloudflare.Hyperdrive.Connect(Hyperdrive);
    return yield* Drizzle.Postgres(connection.connectionString, { relations });
  }),
).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));

export * as HyperdriveDatabase from "./hyperdrive";
