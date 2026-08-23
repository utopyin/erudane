import { index, integer, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { PREFIX } from "../config";
import { table } from "../table";
import { threads } from "./chat";
import { documents } from "./documents";

export const itemStatus = pgEnum(`${PREFIX}_item_status`, ["not_started", "in_progress", "done"]);
export const skillKind = pgEnum(`${PREFIX}_skill_kind`, ["strength", "weakness"]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
};

export const subjects = table("subjects", {
  id: uuid().primaryKey(),
  /** What the subject is, short. */
  title: text().notNull(),
  /** What the subject is, elaborated (agent-refined). */
  about: text().notNull().default(""),
  /** Why the user wants to learn it. */
  motivation: text().notNull().default(""),
  /** Deadline to learn the subject. */
  dueAt: timestamp({ withTimezone: true, mode: "string" }),
  /** The agent's private working note — hidden in the UI by default. */
  note: text().notNull().default(""),
  ...timestamps,
});

/**
 * `position` is 1-based and unique per parent, enforced by the repository's
 * transactional resequencing (a DB unique index would trip mid-renumber).
 * Same for lessons and exercises.
 */
export const chapters = table(
  "chapters",
  {
    id: uuid().primaryKey(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    title: text().notNull(),
    /** One-paragraph agent summary, shown in the outline. */
    summary: text().notNull().default(""),
    dueAt: timestamp({ withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (t) => [index().on(t.subjectId, t.position)],
);

export const lessons = table(
  "lessons",
  {
    id: uuid().primaryKey(),
    chapterId: uuid()
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    title: text().notNull(),
    status: itemStatus().notNull().default("not_started"),
    /** The lesson's collab document, created with the lesson — 1:1. */
    documentId: uuid()
      .notNull()
      .unique()
      .references(() => documents.id),
    dueAt: timestamp({ withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (t) => [index().on(t.chapterId, t.position)],
);

/**
 * An exercise is an agent-led thread: `start` creates a thread anchored here,
 * seeded with an assistant message rendered from `brief`. No `threadId`
 * column — threads point at exercises, so retries are N threads per exercise
 * and "the exercise's thread" is the newest.
 */
export const exercises = table(
  "exercises",
  {
    id: uuid().primaryKey(),
    lessonId: uuid()
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    title: text().notNull(),
    /** Agent-authored: what to exercise, how to run it, the opening question. */
    brief: text().notNull(),
    status: itemStatus().notNull().default("not_started"),
    ...timestamps,
  },
  (t) => [index().on(t.lessonId, t.position)],
);

/** What the user is good/bad at; rewritten wholesale by the agent's `UpdateSkills`. */
export const subjectSkills = table(
  "subject_skills",
  {
    id: uuid().primaryKey(),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    kind: skillKind().notNull(),
    /** One short statement. */
    text: text().notNull(),
    /** The thread where this was observed. */
    sourceThreadId: uuid().references(() => threads.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index().on(t.subjectId, t.kind)],
);

/** Previous values of `subjects.note`, archived on every rewrite. Append-only. */
export const subjectNoteRevisions = table("subject_note_revisions", {
  id: uuid().primaryKey(),
  subjectId: uuid()
    .notNull()
    .references(() => subjects.id, { onDelete: "cascade" }),
  /** The value being replaced. */
  note: text().notNull(),
  replacedAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
