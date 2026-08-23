import { ThreadId } from "@erudane/chat/types";
import { DocumentId } from "@erudane/documents/types";
import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

export const SubjectId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("SubjectId"));
export type SubjectId = typeof SubjectId.Type;

export const ChapterId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ChapterId"));
export type ChapterId = typeof ChapterId.Type;

export const LessonId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("LessonId"));
export type LessonId = typeof LessonId.Type;

export const ExerciseId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ExerciseId"));
export type ExerciseId = typeof ExerciseId.Type;

/** Progress of a lesson or an exercise; set by the user (rpc) or the agent (tool). */
export const ItemStatus = Schema.Literals(["not_started", "in_progress", "done"]);
export type ItemStatus = typeof ItemStatus.Type;

/** Something the user is good at (strength) or needs to deepen (weakness). */
export const SkillKind = Schema.Literals(["strength", "weakness"]);
export type SkillKind = typeof SkillKind.Type;

const subjectFields = {
  id: SubjectId,
  title: Schema.String,
  /** What the subject is, elaborated (agent-refined). */
  about: Schema.String,
  /** Why the user wants to learn it. */
  motivation: Schema.String,
  dueAt: Schema.NullOr(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

/** The agent's private `note` is deliberately absent — hidden by default, read via `note`/`memory`. */
export class Subject extends Schema.Class<Subject>("Subjects.Subject")(subjectFields) {}

const chapterFields = {
  id: ChapterId,
  subjectId: SubjectId,
  /** 1-based position among siblings; the numbered list the user sees. */
  position: Schema.Int,
  title: Schema.String,
  summary: Schema.String,
  dueAt: Schema.NullOr(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export class Chapter extends Schema.Class<Chapter>("Subjects.Chapter")(chapterFields) {}

const lessonFields = {
  id: LessonId,
  chapterId: ChapterId,
  position: Schema.Int,
  title: Schema.String,
  status: ItemStatus,
  /** The lesson's collab document, created with the lesson — 1:1. */
  documentId: DocumentId,
  dueAt: Schema.NullOr(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export class Lesson extends Schema.Class<Lesson>("Subjects.Lesson")(lessonFields) {}

const exerciseFields = {
  id: ExerciseId,
  lessonId: LessonId,
  position: Schema.Int,
  title: Schema.String,
  /** Agent-authored: what to exercise, how to run it, the opening question. */
  brief: Schema.String,
  status: ItemStatus,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export class Exercise extends Schema.Class<Exercise>("Subjects.Exercise")(exerciseFields) {}

export class Skill extends Schema.Class<Skill>("Subjects.Skill")({
  id: Schema.String,
  subjectId: SubjectId,
  kind: SkillKind,
  text: Schema.String,
  /** The thread where this was observed. */
  sourceThreadId: Schema.NullOr(ThreadId),
}) {}

export class OutlineLesson extends Schema.Class<OutlineLesson>("Subjects.OutlineLesson")({
  ...lessonFields,
  exercises: Schema.Array(Exercise),
}) {}

export class OutlineChapter extends Schema.Class<OutlineChapter>("Subjects.OutlineChapter")({
  ...chapterFields,
  lessons: Schema.Array(OutlineLesson),
}) {}

/** The full tree — what the subject page renders and the agent restructures. */
export class Outline extends Schema.Class<Outline>("Subjects.Outline")({
  subject: Subject,
  chapters: Schema.Array(OutlineChapter),
}) {}

/** Everything a run needs to know about a subject, in one read. */
export class SubjectMemory extends Schema.Class<SubjectMemory>("Subjects.Memory")({
  subject: Subject,
  /** The agent's working note — memory is agent-facing, so it rides along. */
  note: Schema.String,
  skills: Schema.Array(Skill),
  chapters: Schema.Array(OutlineChapter),
}) {}

/** Where a thread attaches. The repo resolves the chain and denormalizes `subjectId`. */
export type Anchor = Data.TaggedEnum<{
  Subject: { readonly subjectId: SubjectId };
  Chapter: { readonly chapterId: ChapterId };
  Lesson: { readonly lessonId: LessonId };
  Exercise: { readonly exerciseId: ExerciseId };
}>;
export const Anchor = Data.taggedEnum<Anchor>();

export class ThreadAnchors extends Schema.Class<ThreadAnchors>("Subjects.ThreadAnchors")({
  subjectId: Schema.NullOr(SubjectId),
  chapterId: Schema.NullOr(ChapterId),
  lessonId: Schema.NullOr(LessonId),
  exerciseId: Schema.NullOr(ExerciseId),
}) {}

/** A subject's thread, as the sidebar-of-a-subject sees it. */
export class AnchoredThread extends Schema.Class<AnchoredThread>("Subjects.AnchoredThread")({
  id: ThreadId,
  title: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateTimeUtc,
  anchors: ThreadAnchors,
}) {}

/**
 * One outline mutation, as the agent's `EditOutline` batches them and the rpc
 * carries them. Inserts mint their ids server-side; `at` is 1-based, clamped.
 */
export const OutlineOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("insertChapter"),
    title: Schema.String,
    summary: Schema.optionalKey(Schema.String),
    dueAt: Schema.optionalKey(Schema.DateTimeUtc),
    at: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({
    op: Schema.Literal("updateChapter"),
    chapterId: ChapterId,
    title: Schema.optionalKey(Schema.String),
    summary: Schema.optionalKey(Schema.String),
    dueAt: Schema.optionalKey(Schema.NullOr(Schema.DateTimeUtc)),
  }),
  Schema.Struct({ op: Schema.Literal("moveChapter"), chapterId: ChapterId, to: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("removeChapter"), chapterId: ChapterId }),
  Schema.Struct({
    op: Schema.Literal("insertLesson"),
    chapterId: ChapterId,
    title: Schema.String,
    dueAt: Schema.optionalKey(Schema.DateTimeUtc),
    at: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({
    op: Schema.Literal("updateLesson"),
    lessonId: LessonId,
    title: Schema.optionalKey(Schema.String),
    dueAt: Schema.optionalKey(Schema.NullOr(Schema.DateTimeUtc)),
  }),
  Schema.Struct({ op: Schema.Literal("moveLesson"), lessonId: LessonId, to: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("removeLesson"), lessonId: LessonId }),
  Schema.Struct({
    op: Schema.Literal("insertExercise"),
    lessonId: LessonId,
    title: Schema.String,
    brief: Schema.String,
    at: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({
    op: Schema.Literal("updateExercise"),
    exerciseId: ExerciseId,
    title: Schema.optionalKey(Schema.String),
    brief: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("moveExercise"), exerciseId: ExerciseId, to: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("removeExercise"), exerciseId: ExerciseId }),
]);
export type OutlineOp = typeof OutlineOp.Type;

/** Chapters/lessons/exercises to create with a new subject, in given order. */
export const NewChapters = Schema.Array(
  Schema.Struct({
    title: Schema.String,
    summary: Schema.optionalKey(Schema.String),
    dueAt: Schema.optionalKey(Schema.DateTimeUtc),
    lessons: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          title: Schema.String,
          dueAt: Schema.optionalKey(Schema.DateTimeUtc),
          exercises: Schema.optionalKey(
            Schema.Array(Schema.Struct({ title: Schema.String, brief: Schema.String })),
          ),
        }),
      ),
    ),
  }),
);
export type NewChapters = typeof NewChapters.Type;

export interface NewSubject {
  readonly title: string;
  readonly about?: string | undefined;
  readonly motivation?: string | undefined;
  readonly dueAt?: DateTime.Utc | undefined;
}

export interface SubjectPatch {
  readonly title?: string | undefined;
  readonly about?: string | undefined;
  readonly motivation?: string | undefined;
  readonly dueAt?: DateTime.Utc | null | undefined;
}

export interface NewSkill {
  readonly kind: SkillKind;
  readonly text: string;
  readonly sourceThreadId?: ThreadId | undefined;
}
