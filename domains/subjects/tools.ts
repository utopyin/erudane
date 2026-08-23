/**
 * Tool definitions owned by the subjects domain — how the agent reads and
 * writes subject memory, the outline, and lesson documents.
 *
 * LEAF MODULE: imports only `effect` and leaf types. Never import `./service`
 * or `./handlers` from here — the web app imports this module to type its
 * client tool parts.
 */
import { DocumentId, RoomEdit } from "@erudane/documents/types";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import {
  ExerciseId,
  ItemStatus,
  LessonId,
  NewChapters,
  Outline,
  OutlineOp,
  Subject,
  SubjectId,
} from "./types";

const Failure = Schema.Struct({ message: Schema.String });

export const CreateSubject = Tool.make("CreateSubject", {
  description:
    "Creates a subject the user wants to learn — the durable home for its outline, deadlines, " +
    "and your memory of the user's progress. Use it when a conversation reveals something the " +
    "user wants to learn seriously. Provide an initial chapter outline when you already know " +
    "enough to draft one; you can restructure later with EditOutline. Returns the full outline " +
    "with every id.",
  parameters: Schema.Struct({
    title: Schema.String.annotate({ description: "Short name of the subject." }),
    about: Schema.optionalKey(Schema.String).annotate({
      description: "What the subject is, elaborated.",
    }),
    motivation: Schema.optionalKey(Schema.String).annotate({
      description: "Why the user wants to learn it, in their words.",
    }),
    dueAt: Schema.optionalKey(Schema.DateTimeUtc).annotate({
      description: "ISO date the user wants to be done by.",
    }),
    chapters: Schema.optionalKey(NewChapters).annotate({
      description: "Initial outline: chapters with optional lessons and exercises.",
    }),
  }),
  success: Schema.Struct({ outline: Outline }),
  failure: Failure,
  failureMode: "return",
});

export const UpdateSubject = Tool.make("UpdateSubject", {
  description:
    "Updates a subject's title, elaboration, motivation, or deadline. Only send the fields " +
    "you are changing.",
  parameters: Schema.Struct({
    subjectId: SubjectId,
    title: Schema.optionalKey(Schema.String),
    about: Schema.optionalKey(Schema.String),
    motivation: Schema.optionalKey(Schema.String),
    dueAt: Schema.optionalKey(Schema.NullOr(Schema.DateTimeUtc)).annotate({
      description: "New deadline; null clears it.",
    }),
  }),
  success: Schema.Struct({ subject: Subject }),
  failure: Failure,
  failureMode: "return",
});

export const EditOutline = Tool.make("EditOutline", {
  description:
    "Applies a batch of outline mutations (insert/update/move/remove chapters, lessons, " +
    "exercises) in order. Positions are 1-based and renumbered automatically. Creating a " +
    "lesson also creates its document. Returns the fresh outline with every id.",
  parameters: Schema.Struct({
    subjectId: SubjectId,
    ops: Schema.Array(OutlineOp),
  }),
  success: Schema.Struct({ outline: Outline }),
  failure: Failure,
  failureMode: "return",
});

export const SetStatus = Tool.make("SetStatus", {
  description:
    "Marks a lesson or an exercise as not_started, in_progress, or done. Pass exactly one of " +
    "lessonId / exerciseId. Keep statuses honest — they drive what to teach next.",
  parameters: Schema.Struct({
    lessonId: Schema.optionalKey(LessonId),
    exerciseId: Schema.optionalKey(ExerciseId),
    status: ItemStatus,
  }),
  success: Schema.Struct({ updated: Schema.Literal(true) }),
  failure: Failure,
  failureMode: "return",
});

export const SaveNote = Tool.make("SaveNote", {
  description:
    "Replaces your private working note on a subject — your memory across threads: where the " +
    "user is, what worked, preferences, what to do next time. Full replacement: rewrite the " +
    "whole note, carrying forward what still matters. The user does not see it unless they " +
    "explicitly ask.",
  parameters: Schema.Struct({ subjectId: SubjectId, note: Schema.String }),
  success: Schema.Struct({ saved: Schema.Literal(true) }),
  failure: Failure,
  failureMode: "return",
});

export const UpdateSkills = Tool.make("UpdateSkills", {
  description:
    "Replaces the subject's strengths/weaknesses lists — what the user is good at (build on " +
    "it, skip ahead, draw parallels) and what they need to deepen. Full replacement: send the " +
    "complete lists each time.",
  parameters: Schema.Struct({
    subjectId: SubjectId,
    strengths: Schema.Array(Schema.String),
    weaknesses: Schema.Array(Schema.String),
  }),
  success: Schema.Struct({ saved: Schema.Literal(true) }),
  failure: Failure,
  failureMode: "return",
});

export const CreateExercise = Tool.make("CreateExercise", {
  description:
    "Adds an exercise to a lesson. `brief` is what the user will read when they start it: the " +
    "exercise context and your opening question, written as your first message of that " +
    "conversation. Make it self-contained — you will not get to edit it at start time.",
  parameters: Schema.Struct({
    lessonId: LessonId,
    title: Schema.String,
    brief: Schema.String,
    at: Schema.optionalKey(Schema.Int).annotate({
      description: "1-based position among the lesson's exercises; omit to append.",
    }),
  }),
  success: Schema.Struct({ exerciseId: ExerciseId }),
  failure: Failure,
  failureMode: "return",
});

export const ReadDocument = Tool.make("ReadDocument", {
  description:
    "Reads a lesson document as markdown annotated with block ids " +
    "(`<!-- block:… -->` before each block). Use the ids to target EditDocument ops.",
  parameters: Schema.Struct({ documentId: DocumentId }),
  success: Schema.Struct({ markdown: Schema.String }),
  failure: Failure,
  failureMode: "return",
});

export const EditDocument = Tool.make("EditDocument", {
  description:
    "Edits a lesson document with block-scoped ops (append / insertAfter / replaceBlock / " +
    "deleteBlock, markdown payloads). Changes appear live in the user's editor as you make " +
    "them. Edit block by block — never rewrite the whole document to change one part; " +
    "concurrent edits by the user in other blocks survive yours. Returns the fresh annotated " +
    "markdown.",
  parameters: Schema.Struct({
    documentId: DocumentId,
    ops: Schema.Array(RoomEdit),
  }),
  success: Schema.Struct({ markdown: Schema.String }),
  failure: Failure,
  failureMode: "return",
});

export const toolkit = Toolkit.make(
  CreateSubject,
  UpdateSubject,
  EditOutline,
  SetStatus,
  SaveNote,
  UpdateSkills,
  CreateExercise,
  ReadDocument,
  EditDocument,
);

export * as SubjectTools from "./tools";
