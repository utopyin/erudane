import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import type { StorageError } from "./errors";

export const MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const FileId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("FileId"));
export type FileId = typeof FileId.Type;

export class File extends Schema.Class<File>("Files.File")({
  id: FileId,
  mediaType: Schema.String,
  fileName: Schema.optional(Schema.String),
  size: Schema.Int,
  createdAt: Schema.DateTimeUtc,
}) {}

export interface UploadInput {
  readonly data: Uint8Array;
  readonly mediaType: string;
  readonly fileName?: string | undefined;
}

export interface ResolvedFile {
  readonly file: File;
  readonly body: Stream.Stream<Uint8Array, StorageError>;
  readonly etag?: string | undefined;
}

export const reference = (id: FileId): URL => new URL(`erudane://files/${id}`);

const decodeId = Schema.decodeUnknownOption(FileId);

export const fromReference = (value: string | URL): Option.Option<FileId> => {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return Option.none();
  }
  if (url.protocol !== "erudane:" || url.hostname !== "files") return Option.none();
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.length === 1 ? decodeId(segments[0]) : Option.none();
};
