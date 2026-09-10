import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { RoomError } from "./errors";
import type { DocumentId, RoomEdit } from "./types";

/**
 * The live document room, wherever it runs. The domain requires this contract;
 * the app implements it over the Durable Object namespace — the inversion that
 * keeps cloudflare types out of tier 2.
 */
export interface Interface {
  /** Forward a WebSocket upgrade into the document's room. */
  readonly connect: (
    documentId: DocumentId,
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, RoomError>;
  /** Apply agent ops to the live document; connected editors see them immediately. */
  readonly edit: (
    documentId: DocumentId,
    ops: ReadonlyArray<RoomEdit>,
  ) => Effect.Effect<void, RoomError>;
  /** Current content as markdown annotated with block ids (`RoomEdit` targets). */
  readonly read: (documentId: DocumentId) => Effect.Effect<string, RoomError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@erudane/documents/RoomClient",
) {}

export * as RoomClient from "./rooms";
