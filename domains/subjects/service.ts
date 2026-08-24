import type * as Alchemy from "alchemy";
import type { ThreadNotFound } from "@erudane/chat/errors";
import type { ThreadId } from "@erudane/chat/types";
import type { RepoError as DocumentRepoError } from "@erudane/documents/errors";
import { Documents } from "@erudane/documents/service";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type {
  AnchorNotFound,
  ChapterNotFound,
  ExerciseNotFound,
  LessonNotFound,
  RepoError,
  SubjectNotFound,
} from "./errors";
import * as Ids from "./ids";
import { SubjectRepo } from "./repo";
import type {
  Anchor,
  AnchoredThread,
  Chapter,
  ChapterId,
  Exercise,
  ExerciseId,
  ItemStatus,
  Lesson,
  LessonId,
  NewChapters,
  NewSkill,
  NewSubject,
  Outline,
  OutlineOp,
  Skill,
  Subject,
  SubjectId,
  SubjectMemory,
  SubjectPatch,
} from "./types";

/** An outline edit can target any level, and inserting a lesson creates its document. */
type OutlineError =
  | RepoError
  | SubjectNotFound
  | ChapterNotFound
  | LessonNotFound
  | ExerciseNotFound
  | DocumentRepoError;

/**
 * The one write path for subject behaviour: RPC handlers (the user) and tool
 * handlers (the agent) both call this, never the repositories — the auth
 * middleware (005) will slot in above this seam without touching it. Behaviour
 * beyond delegation: creating a lesson creates its collab document first.
 */
export interface Interface {
  /** Every row is created here, so a NotFound mid-way is a defect, not an error. */
  readonly create: (
    input: NewSubject & { readonly chapters?: NewChapters | undefined },
  ) => Effect.Effect<Outline, RepoError | DocumentRepoError, Alchemy.RuntimeContext>;
  readonly get: (
    id: SubjectId,
  ) => Effect.Effect<Option.Option<Subject>, RepoError, Alchemy.RuntimeContext>;
  readonly list: Effect.Effect<ReadonlyArray<Subject>, RepoError, Alchemy.RuntimeContext>;
  readonly update: (
    id: SubjectId,
    patch: SubjectPatch,
  ) => Effect.Effect<Subject, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;
  readonly outline: (
    id: SubjectId,
  ) => Effect.Effect<Outline, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;

  readonly addChapter: (
    subjectId: SubjectId,
    chapter: {
      readonly title: string;
      readonly summary?: string | undefined;
      readonly dueAt?: DateTime.Utc | undefined;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<Chapter, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;
  /** Creates the lesson's empty collab document, then the lesson — 1:1. */
  readonly addLesson: (
    chapterId: ChapterId,
    lesson: {
      readonly title: string;
      readonly dueAt?: DateTime.Utc | undefined;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<
    Lesson,
    RepoError | ChapterNotFound | DocumentRepoError,
    Alchemy.RuntimeContext
  >;
  readonly addExercise: (
    lessonId: LessonId,
    exercise: {
      readonly title: string;
      readonly brief: string;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<Exercise, RepoError | LessonNotFound, Alchemy.RuntimeContext>;
  /** Applies ops in order (the agent restructures several items per round). */
  readonly editOutline: (
    subjectId: SubjectId,
    ops: ReadonlyArray<OutlineOp>,
  ) => Effect.Effect<Outline, OutlineError, Alchemy.RuntimeContext>;

  readonly setLessonStatus: (
    id: LessonId,
    status: ItemStatus,
  ) => Effect.Effect<void, RepoError | LessonNotFound, Alchemy.RuntimeContext>;
  readonly setExerciseStatus: (
    id: ExerciseId,
    status: ItemStatus,
  ) => Effect.Effect<void, RepoError | ExerciseNotFound, Alchemy.RuntimeContext>;

  readonly replaceSkills: (
    subjectId: SubjectId,
    skills: ReadonlyArray<NewSkill>,
  ) => Effect.Effect<ReadonlyArray<Skill>, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;
  readonly rewriteNote: (
    subjectId: SubjectId,
    note: string,
  ) => Effect.Effect<void, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;
  /** The agent's working note — surfaced only behind an explicit interaction. */
  readonly note: (
    subjectId: SubjectId,
  ) => Effect.Effect<string, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;
  readonly memory: (
    subjectId: SubjectId,
  ) => Effect.Effect<SubjectMemory, RepoError | SubjectNotFound, Alchemy.RuntimeContext>;

  readonly anchorThread: <A extends Anchor>(
    threadId: ThreadId,
    anchor: A,
  ) => Effect.Effect<void, RepoError | ThreadNotFound | AnchorNotFound<A>, Alchemy.RuntimeContext>;
  readonly threadsOf: (
    subjectId: SubjectId,
  ) => Effect.Effect<ReadonlyArray<AnchoredThread>, RepoError, Alchemy.RuntimeContext>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Alchemy.RuntimeContext` is the worker's per-request context; queries open their pool on it.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/subjects/Subjects") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* SubjectRepo.Service;
    const documents = yield* Documents.Service;
    const ids = yield* Ids.make;

    const addLesson: Interface["addLesson"] = (chapterId, lesson) =>
      Effect.gen(function* () {
        const documentId = yield* ids.documentId;
        yield* documents.create({ id: documentId, title: lesson.title });
        return yield* repo.insertLesson(chapterId, {
          id: yield* ids.lessonId,
          title: lesson.title,
          documentId,
          dueAt: lesson.dueAt,
          at: lesson.at,
        });
      });

    const addChapter: Interface["addChapter"] = (subjectId, chapter) =>
      Effect.gen(function* () {
        return yield* repo.insertChapter(subjectId, { id: yield* ids.chapterId, ...chapter });
      });

    const addExercise: Interface["addExercise"] = (lessonId, exercise) =>
      Effect.gen(function* () {
        return yield* repo.insertExercise(lessonId, { id: yield* ids.exerciseId, ...exercise });
      });

    const applyOp = (
      subjectId: SubjectId,
      op: OutlineOp,
    ): Effect.Effect<unknown, OutlineError, Alchemy.RuntimeContext> => {
      switch (op.op) {
        case "insertChapter":
          return addChapter(subjectId, op);
        case "updateChapter":
          return repo.updateChapter(op.chapterId, op);
        case "moveChapter":
          return repo.moveChapter(op.chapterId, op.to);
        case "removeChapter":
          return repo.removeChapter(op.chapterId);
        case "insertLesson":
          return addLesson(op.chapterId, op);
        case "updateLesson":
          return repo.updateLesson(op.lessonId, op);
        case "moveLesson":
          return repo.moveLesson(op.lessonId, op.to);
        case "removeLesson":
          return repo.removeLesson(op.lessonId);
        case "insertExercise":
          return addExercise(op.lessonId, op);
        case "updateExercise":
          return repo.updateExercise(op.exerciseId, op);
        case "moveExercise":
          return repo.moveExercise(op.exerciseId, op.to);
        case "removeExercise":
          return repo.removeExercise(op.exerciseId);
      }
    };

    const editOutline: Interface["editOutline"] = (subjectId, ops) =>
      Effect.gen(function* () {
        for (const op of ops) yield* applyOp(subjectId, op);
        return yield* repo.outline(subjectId);
      });

    const create: Interface["create"] = (input) =>
      Effect.gen(function* () {
        const subject = yield* repo.create({
          id: yield* ids.subjectId,
          title: input.title,
          about: input.about,
          motivation: input.motivation,
          dueAt: input.dueAt,
        });
        for (const chapter of input.chapters ?? []) {
          const created = yield* addChapter(subject.id, {
            title: chapter.title,
            summary: chapter.summary,
            dueAt: chapter.dueAt,
          });
          for (const lesson of chapter.lessons ?? []) {
            const createdLesson = yield* addLesson(created.id, {
              title: lesson.title,
              dueAt: lesson.dueAt,
            });
            for (const exercise of lesson.exercises ?? []) {
              yield* addExercise(createdLesson.id, exercise);
            }
          }
        }
        return yield* repo.outline(subject.id);
      }).pipe(
        // Every id above was minted and inserted in this call; a miss is a broken invariant.
        Effect.catchTag(
          ["Subjects.SubjectNotFound", "Subjects.ChapterNotFound", "Subjects.LessonNotFound"],
          Effect.die,
        ),
      );

    return Service.of({
      create,
      get: (id) => repo.get(id),
      list: repo.list,
      update: (id, patch) => repo.update(id, patch),
      outline: (id) => repo.outline(id),
      addChapter,
      addLesson,
      addExercise,
      editOutline,
      setLessonStatus: (id, status) => repo.setLessonStatus(id, status),
      setExerciseStatus: (id, status) => repo.setExerciseStatus(id, status),
      replaceSkills: (subjectId, skills) => repo.replaceSkills(subjectId, skills),
      rewriteNote: (subjectId, note) => repo.rewriteNote(subjectId, note),
      note: (subjectId) => repo.note(subjectId),
      memory: (subjectId) => repo.memory(subjectId),
      anchorThread: (threadId, anchor) => repo.anchorThread(threadId, anchor),
      threadsOf: (subjectId) => repo.threadsOf(subjectId),
    });
  }),
);

export * as Subjects from "./service";
