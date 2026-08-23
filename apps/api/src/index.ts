import { Run } from "@erudane/chat/run";
import { Chat } from "@erudane/chat/service";
import { ThreadRepo } from "@erudane/chat/threads";
import { Database } from "@erudane/db/service";
import { Files } from "@erudane/files/service";
import { Firecrawl } from "@erudane/firecrawl/service";
import { Http } from "@erudane/http";
import { FileStore } from "@erudane/storage/file-store";
import { R2FileStore } from "@erudane/storage/r2";
import { layer as registry } from "@erudane/http/chat/registry";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
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
    const db = yield* Database.Service;
    const store = yield* FileStore.Service;
    const infrastructure = Layer.mergeAll(
      Layer.succeed(Database.Service, db),
      Layer.succeed(FileStore.Service, store),
    );
    const dependencies = Layer.mergeAll(
      Model.layer,
      registry.pipe(Layer.provide(Firecrawl.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
      infrastructure,
    );
    const domains = Layer.mergeAll(Chat.layer, Files.layer, ThreadRepo.layer).pipe(
      Layer.provide(dependencies),
    );

    // Domain services are built once per isolate; routes take them per request.
    const services = yield* Layer.build(Run.layer.pipe(Layer.provideMerge(domains)));
    const handler = yield* HttpRouter.toHttpEffect(Http.layer);

    return { fetch: handler.pipe(Effect.provideContext(services)) };
  }).pipe(Effect.provide(Layer.mergeAll(Database.layer, R2FileStore.layer))),
) {}
