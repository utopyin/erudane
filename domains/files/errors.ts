import * as Schema from "effect/Schema";
import { FileId } from "./types";

export class UnsupportedMediaType extends Schema.TaggedError<UnsupportedMediaType>()(
  "Files.UnsupportedMediaType",
  { mediaType: Schema.String },
) {}

export class InvalidFile extends Schema.TaggedError<InvalidFile>()("Files.InvalidFile", {
  reason: Schema.String,
}) {}

export class FileTooLarge extends Schema.TaggedError<FileTooLarge>()("Files.FileTooLarge", {
  size: Schema.Int,
  maxBytes: Schema.Int,
}) {}

export class FileNotFound extends Schema.TaggedError<FileNotFound>()("Files.FileNotFound", {
  fileId: FileId,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("Files.StorageError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}
