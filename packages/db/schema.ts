import { defineRelations } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { PREFIX } from "./config";
import { table } from "./table";

export const threads = table("threads", {
  id: uuid().primaryKey(),
  title: text(),
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

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

export const relations = defineRelations({ threads, messages }, (r) => ({
  threads: { messages: r.many.messages() },
  messages: { thread: r.one.threads({ from: r.messages.threadId, to: r.threads.id }) },
}));

export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
