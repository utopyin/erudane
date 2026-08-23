import { index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";
import { PREFIX } from "../config";
import { table } from "../table";
import { chapters, exercises, lessons, subjects } from "./subjects";

/**
 * Chat owns `id/title/timestamps` and messages. The anchor columns
 * (`subjectId/chapterId/lessonId/exerciseId`) are written only by the subjects
 * domain's repository: all optional, at most one deep anchor set, `subjectId`
 * always set alongside a deep anchor (denormalized for "threads of subject").
 * A thread with no anchors is lesson-less mode — plain chat.
 */
export const threads = table(
  "threads",
  {
    id: uuid().primaryKey(),
    title: text(),
    subjectId: uuid().references(() => subjects.id, { onDelete: "cascade" }),
    chapterId: uuid().references(() => chapters.id, { onDelete: "set null" }),
    lessonId: uuid().references(() => lessons.id, { onDelete: "set null" }),
    exerciseId: uuid().references(() => exercises.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index().on(t.subjectId, t.updatedAt)],
);

export const messageRole = pgEnum(`${PREFIX}_message_role`, [
  "system",
  "user",
  "assistant",
  "tool",
]);

export const messages = table(
  "messages",
  {
    id: uuid().primaryKey(),
    threadId: uuid()
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** Position in the thread, assigned by the repository. */
    seq: integer().notNull(),
    role: messageRole().notNull(),
    /** Encoded `Prompt.Message` (effect/unstable/ai); the codec lives with the repository. */
    content: jsonb().$type<unknown>().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index().on(t.threadId, t.seq)],
);
