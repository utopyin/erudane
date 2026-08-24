import { Run } from "@erudane/chat/run";
import { Chat } from "@erudane/chat/service";
import { ThreadRepo } from "@erudane/chat/threads";
import { HyperdriveDatabase } from "@erudane/db/hyperdrive";
import { Files } from "@erudane/files/service";
import { Http } from "@erudane/http";
import { R2FileStore } from "@erudane/storage/r2";
import { Registry } from "@erudane/http/chat/registry";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as Model from "./model";

const application = Run.layer.pipe(
  Layer.provideMerge([
    Chat.layer.pipe(Layer.provideMerge([Model.layer, Registry.layer])),
    Files.layer,
    ThreadRepo.layer,
  ]),
);

/**
 * The API worker. Its init runs at plan time (registering the Hyperdrive and
 * secrets it needs) and at runtime (building the router once per isolate).
 */
export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  { main: import.meta.url, compatibility: { flags: ["nodejs_compat"] } },
  Effect.gen(function* () {
    // Domain services are built once per isolate; routes take them per request.
    const context = yield* Layer.build(application);
    const handler = yield* HttpRouter.toHttpEffect(Http.layer);

    return { fetch: handler.pipe(Effect.provideContext(context)) };
  }).pipe(Effect.provide([HyperdriveDatabase.layer, R2FileStore.layer])),
) {}
