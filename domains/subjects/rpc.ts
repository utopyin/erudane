/**
 * The subjects domain's request/response contract — subjects, outline,
 * exercises, documents metadata, and the explicit agent-note reveal.
 *
 * LEAF MODULE: imports only leaf types/errors and `effect`. The rpc mutations
 * and the agent tools converge on the same `Subjects` service calls — one
 * write path, two actors.
 */
import { RepoError as ChatRepoError, ThreadNotFound } from "@erudane/chat/errors";
import { ThreadId } from "@erudane/chat/types";
import { DocumentNotFound, RepoError as DocumentRepoError } from "@erudane/documents/errors";
import { DocumentId, DocumentMeta } from "@erudane/documents/types";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  ChapterNotFound,
  ExerciseNotFound,
  LessonNotFound,
  RepoError,
  SubjectNotFound,
} from "./errors";
import {
  AnchoredThread,
  ChapterId,
  ExerciseId,
  ItemStatus,
  LessonId,
  NewChapters,
  Outline,
  OutlineOp,
  Subject,
  SubjectId,
} from "./types";

const NotFound = Schema.Union([SubjectNotFound, ChapterNotFound, LessonNotFound, ExerciseNotFound]);

/** An outline edit can target any level, and inserting a lesson creates its document. */
const OutlineError = Schema.Union([...NotFound.members, RepoError, DocumentRepoError]);

const SubjectError = Schema.Union([SubjectNotFound, RepoError]);

export const SubjectRpcs = RpcGroup.make(
  Rpc.make("subjects.list", { success: Schema.Array(Subject), error: RepoError }),
  Rpc.make("subjects.get", {
    payload: { id: SubjectId },
    success: Subject,
    error: SubjectError,
  }),
  Rpc.make("subjects.create", {
    payload: {
      title: Schema.String,
      about: Schema.optionalKey(Schema.String),
      motivation: Schema.optionalKey(Schema.String),
      dueAt: Schema.optionalKey(Schema.DateTimeUtc),
      chapters: Schema.optionalKey(NewChapters),
    },
    success: Outline,
    error: Schema.Union([RepoError, DocumentRepoError]),
  }),
  Rpc.make("subjects.update", {
    payload: {
      id: SubjectId,
      title: Schema.optionalKey(Schema.String),
      about: Schema.optionalKey(Schema.String),
      motivation: Schema.optionalKey(Schema.String),
      dueAt: Schema.optionalKey(Schema.NullOr(Schema.DateTimeUtc)),
    },
    success: Subject,
    error: SubjectError,
  }),
  Rpc.make("subjects.outline", {
    payload: { id: SubjectId },
    success: Outline,
    error: SubjectError,
  }),
  Rpc.make("subjects.editOutline", {
    payload: { id: SubjectId, ops: Schema.Array(OutlineOp) },
    success: Outline,
    error: OutlineError,
  }),
  Rpc.make("subjects.setStatus", {
    payload: {
      lessonId: Schema.optionalKey(LessonId),
      exerciseId: Schema.optionalKey(ExerciseId),
      status: ItemStatus,
    },
    success: Schema.Void,
    error: Schema.Union([LessonNotFound, ExerciseNotFound, RepoError]),
  }),
  Rpc.make("subjects.threads", {
    payload: { id: SubjectId },
    success: Schema.Array(AnchoredThread),
    error: RepoError,
  }),
  /** Attach a thread at one level (exactly one of the four ids). */
  Rpc.make("subjects.anchorThread", {
    payload: {
      threadId: ThreadId,
      subjectId: Schema.optionalKey(SubjectId),
      chapterId: Schema.optionalKey(ChapterId),
      lessonId: Schema.optionalKey(LessonId),
      exerciseId: Schema.optionalKey(ExerciseId),
    },
    success: Schema.Void,
    error: Schema.Union([...NotFound.members, RepoError, ThreadNotFound]),
  }),
  /** The agent's note — hidden in the UI by default, revealed only through this. */
  Rpc.make("subjects.note", {
    payload: { id: SubjectId },
    success: Schema.String,
    error: SubjectError,
  }),
  Rpc.make("exercises.start", {
    payload: { id: ExerciseId, restart: Schema.optionalKey(Schema.Boolean) },
    success: Schema.Struct({ threadId: ThreadId }),
    error: Schema.Union([ExerciseNotFound, RepoError, ChatRepoError]),
  }),
  Rpc.make("documents.get", {
    payload: { id: DocumentId },
    success: DocumentMeta,
    error: Schema.Union([DocumentNotFound, DocumentRepoError]),
  }),
);
