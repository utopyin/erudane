import * as Alchemy from "alchemy";
import { Database } from "@erudane/db/service";
import { files } from "@erudane/db/schema";
import { FileStore } from "@erudane/storage/file-store";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  FileNotFound,
  FileTooLarge,
  InvalidFile,
  StorageError,
  UnsupportedMediaType,
} from "./errors";
import {
  File,
  type FileId,
  MAX_BYTES,
  type MediaType,
  type ResolvedFile,
  type UploadInput,
} from "./types";

export interface Interface {
  readonly upload: (
    input: UploadInput,
  ) => Effect.Effect<
    File,
    InvalidFile | FileTooLarge | UnsupportedMediaType | StorageError,
    Alchemy.RuntimeContext
  >;
  readonly get: (
    id: FileId,
  ) => Effect.Effect<File, FileNotFound | StorageError, Alchemy.RuntimeContext>;
  readonly resolve: (
    id: FileId,
  ) => Effect.Effect<ResolvedFile, FileNotFound | StorageError, Alchemy.RuntimeContext>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * Database and object-store calls share the worker request's runtime context.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/files/Files") {}

const storageFailed = (operation: string) => (cause: unknown) =>
  new StorageError({ operation, cause });

const toFile = (row: typeof files.$inferSelect): File =>
  new File({
    id: row.id as FileId,
    mediaType: row.mediaType,
    fileName: row.fileName ?? undefined,
    size: row.size,
    createdAt: DateTime.makeUnsafe(row.createdAt),
  });

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const detectMediaType = (bytes: Uint8Array): MediaType | undefined => {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return undefined;
};

const normalizeMediaType = (value: string): string =>
  (value.split(";", 1)[0] ?? "").trim().toLowerCase();

const sanitizeFileName = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const leaf = value.split(/[\\/]/).at(-1) ?? "";
  const clean = leaf
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 255);
  return clean.length === 0 ? undefined : clean;
};

const validate = (
  input: UploadInput,
): Effect.Effect<
  { readonly mediaType: string; readonly fileName?: string | undefined },
  InvalidFile | FileTooLarge | UnsupportedMediaType
> => {
  const size = input.data.byteLength;
  if (size === 0) return Effect.fail(new InvalidFile({ reason: "file is empty" }));
  if (size > MAX_BYTES) return Effect.fail(new FileTooLarge({ size, maxBytes: MAX_BYTES }));

  const mediaType = normalizeMediaType(input.mediaType);
  const detected = detectMediaType(input.data);
  if (detected === undefined) return Effect.fail(new UnsupportedMediaType({ mediaType }));
  if (mediaType !== detected) {
    return Effect.fail(
      new InvalidFile({
        reason: `declared media type ${mediaType || "(missing)"} does not match ${detected}`,
      }),
    );
  }
  return Effect.succeed({ mediaType, fileName: sanitizeFileName(input.fileName) });
};

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service;
    const store = yield* FileStore.Service;

    const getRow = Effect.fn("Files.getRow")(function* (id: FileId) {
      const row = yield* db.query.files
        .findFirst({ where: { id } })
        .pipe(Effect.mapError(storageFailed("get metadata")));
      if (row === undefined) return yield* new FileNotFound({ fileId: id });
      return row;
    });

    const get: Interface["get"] = Effect.fn("Files.get")(function* (id) {
      return toFile(yield* getRow(id));
    });

    const upload: Interface["upload"] = Effect.fn("Files.upload")(function* (input) {
      const valid = yield* validate(input);
      // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- one persisted identity
      const id = yield* Effect.sync(() => crypto.randomUUID() as FileId);
      const key = `files/${id}`;

      yield* store
        .put({ key, data: input.data, mediaType: valid.mediaType })
        .pipe(Effect.mapError(storageFailed("write object")));

      const rows = yield* db
        .insert(files)
        .values({
          id,
          key,
          mediaType: valid.mediaType,
          fileName: valid.fileName ?? null,
          size: input.data.byteLength,
        })
        .returning()
        .pipe(
          Effect.mapError(storageFailed("insert metadata")),
          Effect.catch((error) =>
            store.delete(key).pipe(
              Effect.catch((cleanup) =>
                Effect.logWarning("failed to remove object after metadata insert failure", cleanup),
              ),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
      const row = rows[0];
      if (row === undefined) {
        yield* store
          .delete(key)
          .pipe(
            Effect.catch((cleanup) =>
              Effect.logWarning("failed to remove object after empty metadata insert", cleanup),
            ),
          );
        return yield* new StorageError({
          operation: "insert metadata",
          cause: "insert returned no file row",
        });
      }
      return toFile(row);
    });

    const resolve: Interface["resolve"] = Effect.fn("Files.resolve")(function* (id) {
      const row = yield* getRow(id);
      const file = toFile(row);
      const object = yield* store.get(row.key).pipe(Effect.mapError(storageFailed("read object")));
      if (Option.isNone(object)) {
        return yield* new StorageError({
          operation: "read object",
          cause: `object ${row.key} is missing`,
        });
      }
      if (
        object.value.size !== file.size ||
        (object.value.mediaType !== undefined && object.value.mediaType !== file.mediaType)
      ) {
        return yield* new StorageError({
          operation: "read object",
          cause: `object ${row.key} metadata does not match its database row`,
        });
      }
      return {
        file,
        body: object.value.body.pipe(Stream.mapError(storageFailed("stream object"))),
        etag: object.value.etag,
      };
    });

    return Service.of({ upload, get, resolve });
  }),
);

export * as Files from "./service";
