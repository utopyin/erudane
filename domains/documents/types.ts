import * as Schema from "effect/Schema";

export const DocumentId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("DocumentId"));
export type DocumentId = typeof DocumentId.Type;

/** Who last wrote a document: the human in the editor or the agent through tools. */
export const DocumentActor = Schema.Literals(["user", "agent"]);
export type DocumentActor = typeof DocumentActor.Type;
