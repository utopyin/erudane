import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { FileStore } from "./file-store";

/** Private file bucket. File bytes are only served through the API worker. */
export const Bucket = Cloudflare.R2.Bucket("Files").pipe(Alchemy.RemovalPolicy.retain());

const failed = (operation: string) => (cause: unknown) =>
  new FileStore.StoreError({ operation, cause });

const metadata = (object: {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly httpMetadata?: { readonly contentType?: string | undefined } | undefined;
}): FileStore.ObjectMetadata => ({
  key: object.key,
  size: object.size,
  mediaType: object.httpMetadata?.contentType,
  etag: object.httpEtag,
});

/** Cloudflare R2 implementation. Its request effects require Alchemy's runtime context. */
export const layer = Layer.effect(
  FileStore.Service,
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Bucket);

    const put: FileStore.Interface["put"] = (input) =>
      bucket
        .put(input.key, input.data, { httpMetadata: { contentType: input.mediaType } })
        .pipe(Effect.map(metadata), Effect.mapError(failed("put")));

    const get: FileStore.Interface["get"] = (key) =>
      bucket.get(key).pipe(
        Effect.map((object) =>
          object === null
            ? Option.none()
            : Option.some({
                ...metadata(object),
                body: object.body.pipe(Stream.mapError(failed("read"))),
              }),
        ),
        Effect.mapError(failed("get")),
      );

    const head: FileStore.Interface["head"] = (key) =>
      bucket.head(key).pipe(
        Effect.map((object) => Option.map(Option.fromNullOr(object), metadata)),
        Effect.mapError(failed("head")),
      );

    const deleteObject: FileStore.Interface["delete"] = (key) =>
      bucket.delete(key).pipe(Effect.mapError(failed("delete")));

    return FileStore.Service.of({ put, get, head, delete: deleteObject });
  }),
).pipe(Layer.provide(Cloudflare.R2.ReadWriteBucketBinding));

export * as R2FileStore from "./r2";
