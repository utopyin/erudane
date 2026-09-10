import type * as Alchemy from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { DocumentNotFound, type RepoError, type RoomError } from "./errors";
import { DocumentRepo } from "./repo";
import { RoomClient } from "./rooms";
import type { DocumentId, DocumentMeta, RoomEdit } from "./types";

/**
 * Document behaviour outside the sync path. Content reads come from the
 * Postgres projection; the live room is only reached for writes (`edit`) and
 * the agent's block-annotated read.
 */
export interface Interface {
  /** Create the row; the room cold-starts empty (or from `state` after a save). */
  readonly create: (options: {
    readonly id: DocumentId;
    readonly title?: string | undefined;
  }) => Effect.Effect<DocumentMeta, RepoError, Alchemy.RuntimeContext>;
  readonly get: (
    id: DocumentId,
  ) => Effect.Effect<Option.Option<DocumentMeta>, RepoError, Alchemy.RuntimeContext>;
  /** Live markdown annotated with block ids — the agent's `ReadDocument`. */
  readonly read: (id: DocumentId) => Effect.Effect<string, RoomError>;
  /** Agent write path: block ops applied live in the room, mid-run. */
  readonly edit: (id: DocumentId, ops: ReadonlyArray<RoomEdit>) => Effect.Effect<void, RoomError>;
  /** Projection markdown (may trail the live doc by one debounce window). */
  readonly markdown: (
    id: DocumentId,
  ) => Effect.Effect<string, DocumentNotFound | RepoError, Alchemy.RuntimeContext>;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/documents") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* DocumentRepo.Service;
    const rooms = yield* RoomClient.Service;

    return Service.of({
      create: (options) => repo.create(options),
      get: (id) => repo.get(id),
      read: (id) => rooms.read(id),
      edit: (id, ops) => rooms.edit(id, ops),
      markdown: (id) =>
        Effect.flatMap(
          repo.get(id),
          Option.match({
            onNone: () => new DocumentNotFound({ documentId: id }),
            onSome: (meta) => Effect.succeed(meta.markdown),
          }),
        ),
    });
  }),
);

export * as Documents from "./service";
