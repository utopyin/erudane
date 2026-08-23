import { RoomClient } from "@erudane/documents/rooms";
import { DocumentId, RoomEdit } from "@erudane/documents/types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const Params = Schema.Struct({ id: DocumentId });

const roomUnavailable = (error: { readonly message: string }) =>
  Effect.logError("room call failed", error).pipe(
    Effect.as(HttpServerResponse.text("room unavailable", { status: 502 })),
  );

const badRequest = (error: { readonly message: string }) =>
  Effect.succeed(HttpServerResponse.text(error.message, { status: 400 }));

/**
 * `GET /documents/:id`: hand the WebSocket upgrade to the document's live
 * room. The path is exactly `serverUrl/room` so the stock y-websocket
 * `WebsocketProvider("wss://…/documents", documentId, doc)` lands here.
 */
const connect = HttpRouter.add(
  "GET",
  "/documents/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Params);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rooms = yield* RoomClient.Service;
    return yield* rooms.connect(id, request);
  }).pipe(
    Effect.catchTags({
      SchemaError: badRequest,
      "Documents.RoomError": roomUnavailable,
    }),
  ),
);

const EditBody = Schema.Struct({ ops: Schema.Array(RoomEdit) });

/**
 * `POST /documents/:id/edit`: apply block-scoped ops to the live room — the
 * `EditDocument` tool's write path, exposed over HTTP until the tool exists
 * (and the spike's stand-in for the agent).
 */
const edit = HttpRouter.add(
  "POST",
  "/documents/:id/edit",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Params);
    const { ops } = yield* HttpServerRequest.schemaBodyJson(EditBody);
    const rooms = yield* RoomClient.Service;
    yield* rooms.edit(id, ops);
    const markdown = yield* rooms.read(id);
    return HttpServerResponse.jsonUnsafe({ markdown });
  }).pipe(
    Effect.catchTags({
      SchemaError: badRequest,
      "Documents.RoomError": roomUnavailable,
    }),
  ),
);

export const layer = Layer.mergeAll(connect, edit);
