import { Run } from "@erudane/chat/run";
import { Chat } from "@erudane/chat/service";
import { ThreadRepo } from "@erudane/chat/threads";
import { HyperdriveDatabase } from "@erudane/db/hyperdrive";
import { RoomError } from "@erudane/documents/errors";
import { DocumentRepo } from "@erudane/documents/repo";
import { RoomClient } from "@erudane/documents/rooms";
import { Documents } from "@erudane/documents/service";
import { Files } from "@erudane/files/service";
import { Http, PublicUrl } from "@erudane/http";
import { Registry } from "@erudane/http/chat/registry";
import { R2FileStore } from "@erudane/storage/r2";
import { ExerciseRuns } from "@erudane/subjects/exercises";
import { SubjectRepo } from "@erudane/subjects/repo";
import { Subjects } from "@erudane/subjects/service";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import DocumentRoom from "./document";
import * as Model from "./model";

/**
 * Everything above the repositories. The registry's handler layers reach into
 * subjects/documents, so those domains sit below it; repositories and the
 * room client are provided by the worker init (the room client needs the DO
 * namespace binding).
 */
const application = Run.layer.pipe(
  Layer.provideMerge([
    Chat.layer.pipe(Layer.provideMerge([Model.layer, Registry.layer])),
    Files.layer,
  ]),
  Layer.provideMerge([Subjects.layer, ExerciseRuns.layer]),
  Layer.provideMerge(Documents.layer),
  Layer.provideMerge([SubjectRepo.layer, DocumentRepo.layer, ThreadRepo.layer]),
);

/**
 * DO RPC stubs and the self-URL accessor copy `RuntimeContext` into their type
 * verbatim; at runtime the bridge satisfies it on the executing side. Erased
 * here so domain contracts (tier 2) never see an alchemy type.
 */
const remote = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A, E> =>
  effect as unknown as Effect.Effect<A, E>;

/**
 * The API worker. Its init runs at plan time (registering the Hyperdrive and
 * secrets it needs) and at runtime (building the router once per isolate).
 * It also hosts the per-document `DocumentRoom` Durable Object.
 */
export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  { main: import.meta.url, compatibility: { flags: ["nodejs_compat"] } },
  Effect.gen(function* () {
    const rooms = yield* DocumentRoom;
    const url = yield* Cloudflare.Workers.URL;

    const roomError = (documentId: RoomError["documentId"]) => (cause: unknown) =>
      new RoomError({ documentId, message: "room call failed", cause });
    const roomClient = Layer.succeed(
      RoomClient.Service,
      RoomClient.Service.of({
        connect: (documentId, request) =>
          rooms
            .getByName(documentId)
            .fetch(request)
            .pipe(Effect.mapError(roomError(documentId))),
        edit: (documentId, ops) =>
          remote(rooms.getByName(documentId).edit(ops)).pipe(
            Effect.mapError(roomError(documentId)),
          ),
        read: (documentId) =>
          remote(rooms.getByName(documentId).read()).pipe(Effect.mapError(roomError(documentId))),
      }),
    );

    // Domain services are built once per isolate; routes take them per request.
    const context = yield* Layer.build(
      application.pipe(
        Layer.provideMerge(roomClient),
        Layer.provideMerge(Layer.succeed(PublicUrl, remote(url))),
        Layer.provideMerge(BrowserCrypto.layer),
      ),
    );
    // The rpc server layer needs its handler services at router build time.
    const handler = yield* HttpRouter.toHttpEffect(Http.layer).pipe(Effect.provideContext(context));

    return { fetch: handler.pipe(Effect.provideContext(context)) };
  }).pipe(Effect.provide([HyperdriveDatabase.layer, R2FileStore.layer])),
) {}
