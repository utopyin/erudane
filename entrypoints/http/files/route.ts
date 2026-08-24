import { Files } from "@erudane/files/service";
import { FileId, MAX_BYTES } from "@erudane/files/types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

class BodyTooLarge extends Schema.TaggedError<BodyTooLarge>()("FilesRoute.BodyTooLarge", {}) {}
class BodyReadFailed extends Schema.TaggedError<BodyReadFailed>()(
  "FilesRoute.BodyReadFailed",
  {},
) {}

const Path = Schema.Struct({ id: FileId });

const badRequest = (message: string, status = 400) =>
  Effect.succeed(HttpServerResponse.text(message, { status }));

const storageFailed = (error: { readonly operation: string }) =>
  Effect.logError("file storage failed", error).pipe(
    Effect.as(HttpServerResponse.text("storage failed", { status: 500 })),
  );

const decodeFileName = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

interface BodyState {
  readonly chunks: Array<Uint8Array>;
  readonly size: number;
}

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.stream.pipe(
    Stream.mapError(() => new BodyReadFailed()),
    Stream.runFoldEffect(
      (): BodyState => ({ chunks: [], size: 0 }),
      (state, chunk): Effect.Effect<BodyState, BodyTooLarge> => {
        const size = state.size + chunk.byteLength;
        if (size > MAX_BYTES) return Effect.fail(new BodyTooLarge());
        return Effect.succeed({ chunks: [...state.chunks, chunk], size });
      },
    ),
    Effect.map(({ chunks, size }) => {
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return body;
    }),
  );

const responseFile = (file: {
  readonly id: string;
  readonly mediaType: string;
  readonly fileName?: string | undefined;
  readonly size: number;
}) => ({
  id: file.id,
  mediaType: file.mediaType,
  fileName: file.fileName,
  size: file.size,
});

/** `POST /files`: raw file bytes with media type and display name in headers. */
const upload = HttpRouter.add(
  "POST",
  "/files",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const declaredLength = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return yield* new BodyTooLarge();
    }

    const data = yield* readBody(request);
    const files = yield* Files.Service;
    const file = yield* files.upload({
      data,
      mediaType: request.headers["content-type"] ?? "",
      fileName: decodeFileName(request.headers["x-file-name"]),
    });
    return HttpServerResponse.jsonUnsafe(responseFile(file), { status: 201 });
  }).pipe(
    Effect.catchTags({
      "FilesRoute.BodyTooLarge": () => badRequest(`file exceeds ${MAX_BYTES} bytes`, 413),
      "FilesRoute.BodyReadFailed": () => badRequest("could not read upload body"),
      "Files.FileTooLarge": (error) => badRequest(`file exceeds ${error.maxBytes} bytes`, 413),
      "Files.UnsupportedMediaType": (error) =>
        badRequest(`unsupported media type: ${error.mediaType || "missing"}`, 415),
      "Files.InvalidFile": (error) => badRequest(error.reason),
      "Files.StorageError": storageFailed,
    }),
  ),
);

const encodeFileName = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const fileName = (name: string | undefined, mediaType: string): string => {
  if (name !== undefined) return name;
  return mediaType === "application/pdf" ? "document.pdf" : "image";
};

/** `GET /files/:id`: stream a private object through the API worker. */
const get = HttpRouter.add(
  "GET",
  "/files/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Path);
    const files = yield* Files.Service;
    const resolved = yield* files.resolve(id);
    const encodedName = encodeFileName(fileName(resolved.file.fileName, resolved.file.mediaType));
    return HttpServerResponse.stream(resolved.body, {
      contentType: resolved.file.mediaType,
      contentLength: resolved.file.size,
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
        "x-content-type-options": "nosniff",
        ...(resolved.etag === undefined ? {} : { etag: resolved.etag }),
      },
    });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Files.FileNotFound": () => badRequest("file not found", 404),
      "Files.StorageError": storageFailed,
    }),
  ),
);

export const layer = Layer.mergeAll(upload, get);
