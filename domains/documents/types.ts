import * as Schema from "effect/Schema";

/** The Y.XmlFragment BlockNote collaborates on; server and client pass the same name. */
export const FRAGMENT = "document";

export const DocumentId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("DocumentId"));
export type DocumentId = typeof DocumentId.Type;

/** Who last wrote a document: the human in the editor or the agent through tools. */
export const DocumentActor = Schema.Literals(["user", "agent"]);
export type DocumentActor = typeof DocumentActor.Type;

/** The Postgres row minus the CRDT snapshot — what readers outside the sync path see. */
export class DocumentMeta extends Schema.Class<DocumentMeta>("Documents.Meta")({
  id: DocumentId,
  title: Schema.String,
  /** Model-facing projection, refreshed by the room on debounced save. */
  markdown: Schema.String,
  version: Schema.Int,
  updatedBy: Schema.NullOr(DocumentActor),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

/**
 * Block-scoped edit operations the agent applies to a live document.
 * Block-level granularity is what lets a concurrent human edit in one
 * paragraph survive an agent rewrite of another.
 */
export const RoomEdit = Schema.Union([
  Schema.Struct({ op: Schema.Literal("append"), markdown: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("insertAfter"),
    blockId: Schema.String,
    markdown: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literal("replaceBlock"),
    blockId: Schema.String,
    markdown: Schema.String,
  }),
  Schema.Struct({ op: Schema.Literal("deleteBlock"), blockId: Schema.String }),
]);
export type RoomEdit = typeof RoomEdit.Type;
