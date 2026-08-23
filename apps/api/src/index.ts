import { Chat } from "@erudane/chat/service";
import { Db } from "@erudane/db/service";
import { Http } from "@erudane/http";
import { layer as registry } from "@erudane/http/chat/registry";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as Model from "./model";

/**
 * The API worker. Its init runs at plan time (registering the Hyperdrive and
 * secrets it needs) and at runtime (building the router once per isolate).
 */
export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  { main: import.meta.url, compatibility: { flags: ["nodejs_compat"] } },
  Effect.gen(function* () {
    const db = yield* Db.Service;

    // Domain services are built once per isolate; routes take them per request.
    const services = yield* Layer.build(
      Chat.layer.pipe(
        Layer.provide(Layer.mergeAll(Model.layer, registry)),
        Layer.provideMerge(Layer.succeed(Db.Service, db)),
      ),
    );
    const handler = yield* HttpRouter.toHttpEffect(Http.layer);

    return { fetch: handler.pipe(Effect.provideContext(services)) };
  }).pipe(Effect.provide(Db.layer)),
) {}
