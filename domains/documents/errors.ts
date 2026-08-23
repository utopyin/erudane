import * as Schema from "effect/Schema";
import { DocumentId } from "./types";

export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()(
  "Documents.DocumentNotFound",
  { documentId: DocumentId },
) {}

/** Storage failure at the repository seam; the cause is the driver's error. */
export class RepoError extends Schema.TaggedError<RepoError>()("Documents.RepoError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
