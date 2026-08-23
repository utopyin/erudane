import { bytea, integer, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { PREFIX } from "../config";
import { table } from "../table";

export const documentActor = pgEnum(`${PREFIX}_document_actor`, ["user", "agent"]);

/**
 * A lesson's written document. The collab layer (the DocumentRoom DO) is the
 * authority on content; this row is the durable projection the rest of the
 * system reads, plus the snapshot that cold-starts the room.
 */
export const documents = table("documents", {
  /** Also the collab room id. */
  id: uuid().primaryKey(),
  title: text().notNull().default(""),
  /** Model-facing projection: lesson context for prompts, future search index. */
  markdown: text().notNull().default(""),
  /** Latest CRDT snapshot — cold-start seed and backup. */
  state: bytea(),
  /** Bumped per projection write; optimistic concurrency for non-collab writers. */
  version: integer().notNull().default(0),
  /** Who caused the last projection write. */
  updatedBy: documentActor(),
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
