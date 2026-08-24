import type * as Alchemy from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export class StoreError extends Schema.TaggedError<StoreError>()("FileStore.Error", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

export interface ObjectMetadata {
  readonly key: string;
  readonly size: number;
  readonly mediaType?: string | undefined;
  readonly etag?: string | undefined;
}

export interface StoredObject extends ObjectMetadata {
  readonly body: Stream.Stream<Uint8Array, StoreError>;
}

export interface PutInput {
  readonly key: string;
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface Interface {
  readonly put: (
    input: PutInput,
  ) => Effect.Effect<ObjectMetadata, StoreError, Alchemy.RuntimeContext>;
  readonly get: (
    key: string,
  ) => Effect.Effect<Option.Option<StoredObject>, StoreError, Alchemy.RuntimeContext>;
  readonly head: (
    key: string,
  ) => Effect.Effect<Option.Option<ObjectMetadata>, StoreError, Alchemy.RuntimeContext>;
  readonly delete: (key: string) => Effect.Effect<void, StoreError, Alchemy.RuntimeContext>;
}

/**
 * Provider-neutral object storage by opaque key.
 *
 * @effect-expect-leaking RuntimeContext
 * Bound object-store operations run inside the worker request context.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/storage/FileStore") {}

interface MemoryObject {
  readonly data: Uint8Array;
  readonly mediaType: string;
  readonly etag: string;
}

const copy = (data: Uint8Array): Uint8Array => data.slice();

/** In-memory implementation for isolated domain checks. */
export const memory = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make(new Map<string, MemoryObject>());

    const put = Effect.fn("FileStore.put")(function* (input: PutInput) {
      const object = {
        data: copy(input.data),
        mediaType: input.mediaType,
        etag: `memory-${input.data.byteLength}`,
      };
      yield* Ref.update(state, (objects) => new Map(objects).set(input.key, object));
      return {
        key: input.key,
        size: object.data.byteLength,
        mediaType: object.mediaType,
        etag: object.etag,
      };
    });

    const get = Effect.fn("FileStore.get")(function* (key: string) {
      const object = (yield* Ref.get(state)).get(key);
      return object === undefined
        ? Option.none()
        : Option.some({
            key,
            size: object.data.byteLength,
            mediaType: object.mediaType,
            etag: object.etag,
            body: Stream.succeed(copy(object.data)),
          });
    });

    const head = Effect.fn("FileStore.head")(function* (key: string) {
      const object = (yield* Ref.get(state)).get(key);
      return object === undefined
        ? Option.none()
        : Option.some({
            key,
            size: object.data.byteLength,
            mediaType: object.mediaType,
            etag: object.etag,
          });
    });

    const deleteObject = Effect.fn("FileStore.delete")(function* (key: string) {
      yield* Ref.update(state, (objects) => {
        const next = new Map(objects);
        next.delete(key);
        return next;
      });
    });

    return Service.of({ put, get, head, delete: deleteObject });
  }),
);

export * as FileStore from "./file-store";
