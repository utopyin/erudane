import { ThreadNotFound } from "@erudane/chat/errors";
import type { ThreadId } from "@erudane/chat/types";
import {
  chapters,
  exercises,
  lessons,
  subjects,
  subjectNoteRevisions,
  subjectSkills,
  threads,
} from "@erudane/db/schema";
import { Database } from "@erudane/db/service";
import type { DocumentId } from "@erudane/documents/types";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  ChapterNotFound,
  ExerciseNotFound,
  LessonNotFound,
  RepoError,
  SubjectNotFound,
} from "./errors";
import {
  Anchor,
  AnchoredThread,
  Chapter,
  type ChapterId,
  Exercise,
  type ExerciseId,
  type ItemStatus,
  Lesson,
  type LessonId,
  type NewSkill,
  type NewSubject,
  Outline,
  OutlineChapter,
  OutlineLesson,
  Skill,
  Subject,
  type SubjectId,
  SubjectMemory,
  type SubjectPatch,
  ThreadAnchors,
} from "./types";

type NotFound = SubjectNotFound | ChapterNotFound | LessonNotFound | ExerciseNotFound;

/**
 * One repository for the whole aggregate: chapters/lessons/exercises have no
 * meaning outside their subject, and every outline mutation resequences
 * siblings transactionally — one repo keeps that in one transaction boundary.
 * Also the only writer of the `eru_threads` anchor columns.
 */
export interface Interface {
  readonly create: (
    subject: { readonly id: SubjectId } & NewSubject,
  ) => Effect.Effect<Subject, RepoError, Database.Runtime>;
  readonly get: (
    id: SubjectId,
  ) => Effect.Effect<Option.Option<Subject>, RepoError, Database.Runtime>;
  readonly list: Effect.Effect<ReadonlyArray<Subject>, RepoError, Database.Runtime>;
  readonly update: (
    id: SubjectId,
    patch: SubjectPatch,
  ) => Effect.Effect<Subject, RepoError | NotFound, Database.Runtime>;
  /** The full tree, ordered by position at every level. */
  readonly outline: (
    id: SubjectId,
  ) => Effect.Effect<Outline, RepoError | NotFound, Database.Runtime>;

  /** `at` is the desired 1-based position, clamped; omitted = append. */
  readonly insertChapter: (
    subjectId: SubjectId,
    chapter: {
      readonly id: ChapterId;
      readonly title: string;
      readonly summary?: string | undefined;
      readonly dueAt?: DateTime.Utc | undefined;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<Chapter, RepoError | NotFound, Database.Runtime>;
  readonly updateChapter: (
    id: ChapterId,
    patch: {
      readonly title?: string | undefined;
      readonly summary?: string | undefined;
      readonly dueAt?: DateTime.Utc | null | undefined;
    },
  ) => Effect.Effect<Chapter, RepoError | NotFound, Database.Runtime>;
  readonly moveChapter: (
    id: ChapterId,
    to: number,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;
  readonly removeChapter: (
    id: ChapterId,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;

  readonly insertLesson: (
    chapterId: ChapterId,
    lesson: {
      readonly id: LessonId;
      readonly title: string;
      readonly documentId: DocumentId;
      readonly dueAt?: DateTime.Utc | undefined;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<Lesson, RepoError | NotFound, Database.Runtime>;
  readonly updateLesson: (
    id: LessonId,
    patch: {
      readonly title?: string | undefined;
      readonly dueAt?: DateTime.Utc | null | undefined;
    },
  ) => Effect.Effect<Lesson, RepoError | NotFound, Database.Runtime>;
  readonly moveLesson: (
    id: LessonId,
    to: number,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;
  readonly removeLesson: (
    id: LessonId,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;

  readonly insertExercise: (
    lessonId: LessonId,
    exercise: {
      readonly id: ExerciseId;
      readonly title: string;
      readonly brief: string;
      readonly at?: number | undefined;
    },
  ) => Effect.Effect<Exercise, RepoError | NotFound, Database.Runtime>;
  readonly updateExercise: (
    id: ExerciseId,
    patch: { readonly title?: string | undefined; readonly brief?: string | undefined },
  ) => Effect.Effect<Exercise, RepoError | NotFound, Database.Runtime>;
  readonly moveExercise: (
    id: ExerciseId,
    to: number,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;
  readonly removeExercise: (
    id: ExerciseId,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;

  readonly setLessonStatus: (
    id: LessonId,
    status: ItemStatus,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;
  readonly setExerciseStatus: (
    id: ExerciseId,
    status: ItemStatus,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;

  /** Replaces the whole list — the agent rewrites skills wholesale. */
  readonly replaceSkills: (
    subjectId: SubjectId,
    skills: ReadonlyArray<NewSkill>,
  ) => Effect.Effect<ReadonlyArray<Skill>, RepoError | NotFound, Database.Runtime>;
  /** Archives the previous value to `note_revisions`, then replaces. */
  readonly rewriteNote: (
    subjectId: SubjectId,
    note: string,
  ) => Effect.Effect<void, RepoError | NotFound, Database.Runtime>;
  readonly note: (
    subjectId: SubjectId,
  ) => Effect.Effect<string, RepoError | NotFound, Database.Runtime>;
  /** Subject + note + skills + outline in one read — what a run consumes. */
  readonly memory: (
    subjectId: SubjectId,
  ) => Effect.Effect<SubjectMemory, RepoError | NotFound, Database.Runtime>;

  /** One exercise, for seeding its agent-led thread. */
  readonly exercise: (
    id: ExerciseId,
  ) => Effect.Effect<Exercise, RepoError | NotFound, Database.Runtime>;

  /** Resolves the parent chain, writes `subjectId` + the one deep column. */
  readonly anchorThread: (
    threadId: ThreadId,
    anchor: Anchor,
  ) => Effect.Effect<void, RepoError | NotFound | ThreadNotFound, Database.Runtime>;
  readonly anchorsOf: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ThreadAnchors>, RepoError, Database.Runtime>;
  readonly threadsOf: (
    subjectId: SubjectId,
  ) => Effect.Effect<ReadonlyArray<AnchoredThread>, RepoError, Database.Runtime>;
  readonly newestThreadOf: (
    exerciseId: ExerciseId,
  ) => Effect.Effect<Option.Option<ThreadId>, RepoError, Database.Runtime>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Database.Runtime` is the worker's per-request context; queries open their pool on it.
 */
export class Service extends Context.Service<Service, Interface>()(
  "@erudane/subjects/SubjectRepo",
) {}

const fail = (message: string) => (cause: unknown) => new RepoError({ message, cause });

type DomainError = NotFound | ThreadNotFound | RepoError;
const isDomainError = Schema.is(
  Schema.Union([
    SubjectNotFound,
    ChapterNotFound,
    LessonNotFound,
    ExerciseNotFound,
    ThreadNotFound,
    RepoError,
  ]),
);

/** Domain errors pass through; anything else (driver failures) becomes `RepoError`. */
const mapRepoError =
  (message: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Extract<E, DomainError> | RepoError, R> =>
    Effect.mapError(effect, (error) =>
      isDomainError(error) ? (error as Extract<E, DomainError>) : fail(message)(error),
    );

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);
const isoOrNull = (value: DateTime.Utc | null | undefined) => (value ? iso(value) : null);
const utc = (value: string) => DateTime.makeUnsafe(value);
const utcOrNull = (value: string | null) => (value === null ? null : utc(value));

const toSubject = (row: typeof subjects.$inferSelect): Subject =>
  new Subject({
    id: row.id as SubjectId,
    title: row.title,
    about: row.about,
    motivation: row.motivation,
    dueAt: utcOrNull(row.dueAt),
    createdAt: utc(row.createdAt),
    updatedAt: utc(row.updatedAt),
  });

const toChapter = (row: typeof chapters.$inferSelect): Chapter =>
  new Chapter({
    id: row.id as ChapterId,
    subjectId: row.subjectId as SubjectId,
    position: row.position,
    title: row.title,
    summary: row.summary,
    dueAt: utcOrNull(row.dueAt),
    createdAt: utc(row.createdAt),
    updatedAt: utc(row.updatedAt),
  });

const toLesson = (row: typeof lessons.$inferSelect): Lesson =>
  new Lesson({
    id: row.id as LessonId,
    chapterId: row.chapterId as ChapterId,
    position: row.position,
    title: row.title,
    status: row.status,
    documentId: row.documentId as DocumentId,
    dueAt: utcOrNull(row.dueAt),
    createdAt: utc(row.createdAt),
    updatedAt: utc(row.updatedAt),
  });

const toExercise = (row: typeof exercises.$inferSelect): Exercise =>
  new Exercise({
    id: row.id as ExerciseId,
    lessonId: row.lessonId as LessonId,
    position: row.position,
    title: row.title,
    brief: row.brief,
    status: row.status,
    createdAt: utc(row.createdAt),
    updatedAt: utc(row.updatedAt),
  });

const toSkill = (row: typeof subjectSkills.$inferSelect): Skill =>
  new Skill({
    id: row.id,
    subjectId: row.subjectId as SubjectId,
    kind: row.kind,
    text: row.text,
    sourceThreadId: row.sourceThreadId as ThreadId | null,
  });

const toAnchors = (row: {
  subjectId: string | null;
  chapterId: string | null;
  lessonId: string | null;
  exerciseId: string | null;
}): ThreadAnchors =>
  new ThreadAnchors({
    subjectId: row.subjectId as SubjectId | null,
    chapterId: row.chapterId as ChapterId | null,
    lessonId: row.lessonId as LessonId | null,
    exerciseId: row.exerciseId as ExerciseId | null,
  });

/** Splice `id` into `ids` at the (1-based, clamped) position; `ids` must not contain it. */
const placed = (ids: ReadonlyArray<string>, id: string, at: number | undefined) => {
  const index = Math.max(0, Math.min(ids.length, (at ?? ids.length + 1) - 1));
  return [...ids.slice(0, index), id, ...ids.slice(index)];
};

// @effect-diagnostics-next-line cryptoRandomUUID:off -- repo-internal row ids (skills, revisions), no service worth requiring
const rowId = () => crypto.randomUUID();

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service;

    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

    const bumpSubject = (tx: Tx, subjectId: string, at: string) =>
      tx.update(subjects).set({ updatedAt: at }).where(eq(subjects.id, subjectId));

    const subjectRow = (tx: Tx, id: SubjectId) =>
      Effect.flatMap(tx.query.subjects.findFirst({ where: { id } }), (row) =>
        row === undefined ? new SubjectNotFound({ subjectId: id }) : Effect.succeed(row),
      );
    const chapterRow = (tx: Tx, id: ChapterId) =>
      Effect.flatMap(tx.query.chapters.findFirst({ where: { id } }), (row) =>
        row === undefined ? new ChapterNotFound({ chapterId: id }) : Effect.succeed(row),
      );
    const lessonRow = (tx: Tx, id: LessonId) =>
      Effect.flatMap(tx.query.lessons.findFirst({ where: { id } }), (row) =>
        row === undefined ? new LessonNotFound({ lessonId: id }) : Effect.succeed(row),
      );
    const exerciseRow = (tx: Tx, id: ExerciseId) =>
      Effect.flatMap(tx.query.exercises.findFirst({ where: { id } }), (row) =>
        row === undefined ? new ExerciseNotFound({ exerciseId: id }) : Effect.succeed(row),
      );

    /** subjectId of a lesson (via its chapter). */
    const lessonSubject = (tx: Tx, row: typeof lessons.$inferSelect) =>
      Effect.map(chapterRow(tx, row.chapterId as ChapterId), (chapter) => chapter.subjectId);
    /** subjectId of an exercise (via lesson → chapter). */
    const exerciseSubject = (tx: Tx, row: typeof exercises.$inferSelect) =>
      Effect.flatMap(lessonRow(tx, row.lessonId as LessonId), (lesson) =>
        lessonSubject(tx, lesson),
      );

    const renumberChapters = (tx: Tx, ids: ReadonlyArray<string>) =>
      Effect.forEach(
        ids,
        (id, index) =>
          tx
            .update(chapters)
            .set({ position: index + 1 })
            .where(eq(chapters.id, id)),
        { discard: true },
      );
    const renumberLessons = (tx: Tx, ids: ReadonlyArray<string>) =>
      Effect.forEach(
        ids,
        (id, index) =>
          tx
            .update(lessons)
            .set({ position: index + 1 })
            .where(eq(lessons.id, id)),
        { discard: true },
      );
    const renumberExercises = (tx: Tx, ids: ReadonlyArray<string>) =>
      Effect.forEach(
        ids,
        (id, index) =>
          tx
            .update(exercises)
            .set({ position: index + 1 })
            .where(eq(exercises.id, id)),
        { discard: true },
      );

    const chapterIds = (tx: Tx, subjectId: string) =>
      Effect.map(
        tx.query.chapters.findMany({
          where: { subjectId },
          orderBy: { position: "asc" },
          columns: { id: true },
        }),
        (rows) => rows.map((row) => row.id),
      );
    const lessonIds = (tx: Tx, chapterId: string) =>
      Effect.map(
        tx.query.lessons.findMany({
          where: { chapterId },
          orderBy: { position: "asc" },
          columns: { id: true },
        }),
        (rows) => rows.map((row) => row.id),
      );
    const exerciseIds = (tx: Tx, lessonId: string) =>
      Effect.map(
        tx.query.exercises.findMany({
          where: { lessonId },
          orderBy: { position: "asc" },
          columns: { id: true },
        }),
        (rows) => rows.map((row) => row.id),
      );

    const outlineChapters = (subjectId: string) =>
      db.query.chapters
        .findMany({
          where: { subjectId },
          orderBy: { position: "asc" },
          with: {
            lessons: {
              orderBy: { position: "asc" },
              with: { exercises: { orderBy: { position: "asc" } } },
            },
          },
        })
        .pipe(
          Effect.map((rows) =>
            rows.map(
              (chapter) =>
                new OutlineChapter({
                  ...toChapter(chapter),
                  lessons: chapter.lessons.map(
                    (lesson) =>
                      new OutlineLesson({
                        ...toLesson(lesson),
                        exercises: lesson.exercises.map(toExercise),
                      }),
                  ),
                }),
            ),
          ),
        );

    const service: Interface = {
      create: (subject) =>
        db
          .insert(subjects)
          .values({
            id: subject.id,
            title: subject.title,
            about: subject.about ?? "",
            motivation: subject.motivation ?? "",
            dueAt: isoOrNull(subject.dueAt),
          })
          .returning()
          .pipe(
            Effect.map((rows) => toSubject(rows[0]!)),
            Effect.mapError(fail("create subject")),
          ),

      get: (id) =>
        db.query.subjects.findFirst({ where: { id } }).pipe(
          Effect.map((row) => Option.map(Option.fromUndefinedOr(row), toSubject)),
          Effect.mapError(fail("get subject")),
        ),

      list: db.query.subjects.findMany({ orderBy: { updatedAt: "desc" } }).pipe(
        Effect.map((rows) => rows.map(toSubject)),
        Effect.mapError(fail("list subjects")),
      ),

      update: (id, patch) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* subjectRow(tx, id);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .update(subjects)
                .set({
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.about !== undefined ? { about: patch.about } : {}),
                  ...(patch.motivation !== undefined ? { motivation: patch.motivation } : {}),
                  ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
                  updatedAt: at,
                })
                .where(eq(subjects.id, id))
                .returning();
              return toSubject(rows[0]!);
            }),
          )
          .pipe(mapRepoError("update subject")),

      outline: (id) =>
        Effect.gen(function* () {
          const subject = yield* db.query.subjects.findFirst({ where: { id } });
          if (subject === undefined) return yield* new SubjectNotFound({ subjectId: id });
          return new Outline({
            subject: toSubject(subject),
            chapters: yield* outlineChapters(id),
          });
        }).pipe(mapRepoError("read outline")),

      insertChapter: (subjectId, chapter) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* subjectRow(tx, subjectId);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .insert(chapters)
                .values({
                  id: chapter.id,
                  subjectId,
                  position: 0,
                  title: chapter.title,
                  summary: chapter.summary ?? "",
                  dueAt: isoOrNull(chapter.dueAt),
                })
                .returning();
              const siblings = yield* chapterIds(tx, subjectId);
              const ordered = placed(
                siblings.filter((id) => id !== chapter.id),
                chapter.id,
                chapter.at,
              );
              yield* renumberChapters(tx, ordered);
              yield* bumpSubject(tx, subjectId, at);
              return toChapter({ ...rows[0]!, position: ordered.indexOf(chapter.id) + 1 });
            }),
          )
          .pipe(mapRepoError("insert chapter")),

      updateChapter: (id, patch) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* chapterRow(tx, id);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .update(chapters)
                .set({
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
                  ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
                  updatedAt: at,
                })
                .where(eq(chapters.id, id))
                .returning();
              yield* bumpSubject(tx, row.subjectId, at);
              return toChapter(rows[0]!);
            }),
          )
          .pipe(mapRepoError("update chapter")),

      moveChapter: (id, to) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* chapterRow(tx, id);
              const siblings = yield* chapterIds(tx, row.subjectId);
              yield* renumberChapters(
                tx,
                placed(
                  siblings.filter((sibling) => sibling !== id),
                  id,
                  to,
                ),
              );
              yield* bumpSubject(tx, row.subjectId, iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("move chapter")),

      removeChapter: (id) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* chapterRow(tx, id);
              yield* tx.delete(chapters).where(eq(chapters.id, id));
              yield* renumberChapters(tx, yield* chapterIds(tx, row.subjectId));
              yield* bumpSubject(tx, row.subjectId, iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("remove chapter")),

      insertLesson: (chapterId, lesson) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const chapter = yield* chapterRow(tx, chapterId);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .insert(lessons)
                .values({
                  id: lesson.id,
                  chapterId,
                  position: 0,
                  title: lesson.title,
                  documentId: lesson.documentId,
                  dueAt: isoOrNull(lesson.dueAt),
                })
                .returning();
              const siblings = yield* lessonIds(tx, chapterId);
              const ordered = placed(
                siblings.filter((id) => id !== lesson.id),
                lesson.id,
                lesson.at,
              );
              yield* renumberLessons(tx, ordered);
              yield* bumpSubject(tx, chapter.subjectId, at);
              return toLesson({ ...rows[0]!, position: ordered.indexOf(lesson.id) + 1 });
            }),
          )
          .pipe(mapRepoError("insert lesson")),

      updateLesson: (id, patch) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* lessonRow(tx, id);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .update(lessons)
                .set({
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
                  updatedAt: at,
                })
                .where(eq(lessons.id, id))
                .returning();
              yield* bumpSubject(tx, yield* lessonSubject(tx, row), at);
              return toLesson(rows[0]!);
            }),
          )
          .pipe(mapRepoError("update lesson")),

      moveLesson: (id, to) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* lessonRow(tx, id);
              const siblings = yield* lessonIds(tx, row.chapterId);
              yield* renumberLessons(
                tx,
                placed(
                  siblings.filter((sibling) => sibling !== id),
                  id,
                  to,
                ),
              );
              yield* bumpSubject(tx, yield* lessonSubject(tx, row), iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("move lesson")),

      removeLesson: (id) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* lessonRow(tx, id);
              const subjectId = yield* lessonSubject(tx, row);
              yield* tx.delete(lessons).where(eq(lessons.id, id));
              yield* renumberLessons(tx, yield* lessonIds(tx, row.chapterId));
              yield* bumpSubject(tx, subjectId, iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("remove lesson")),

      insertExercise: (lessonId, exercise) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const lesson = yield* lessonRow(tx, lessonId);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .insert(exercises)
                .values({
                  id: exercise.id,
                  lessonId,
                  position: 0,
                  title: exercise.title,
                  brief: exercise.brief,
                })
                .returning();
              const siblings = yield* exerciseIds(tx, lessonId);
              const ordered = placed(
                siblings.filter((id) => id !== exercise.id),
                exercise.id,
                exercise.at,
              );
              yield* renumberExercises(tx, ordered);
              yield* bumpSubject(tx, yield* lessonSubject(tx, lesson), at);
              return toExercise({ ...rows[0]!, position: ordered.indexOf(exercise.id) + 1 });
            }),
          )
          .pipe(mapRepoError("insert exercise")),

      updateExercise: (id, patch) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* exerciseRow(tx, id);
              const at = iso(yield* DateTime.now);
              const rows = yield* tx
                .update(exercises)
                .set({
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
                  updatedAt: at,
                })
                .where(eq(exercises.id, id))
                .returning();
              yield* bumpSubject(tx, yield* exerciseSubject(tx, row), at);
              return toExercise(rows[0]!);
            }),
          )
          .pipe(mapRepoError("update exercise")),

      moveExercise: (id, to) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* exerciseRow(tx, id);
              const siblings = yield* exerciseIds(tx, row.lessonId);
              yield* renumberExercises(
                tx,
                placed(
                  siblings.filter((sibling) => sibling !== id),
                  id,
                  to,
                ),
              );
              yield* bumpSubject(tx, yield* exerciseSubject(tx, row), iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("move exercise")),

      removeExercise: (id) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* exerciseRow(tx, id);
              const subjectId = yield* exerciseSubject(tx, row);
              yield* tx.delete(exercises).where(eq(exercises.id, id));
              yield* renumberExercises(tx, yield* exerciseIds(tx, row.lessonId));
              yield* bumpSubject(tx, subjectId, iso(yield* DateTime.now));
            }),
          )
          .pipe(mapRepoError("remove exercise")),

      setLessonStatus: (id, status) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* lessonRow(tx, id);
              const at = iso(yield* DateTime.now);
              yield* tx.update(lessons).set({ status, updatedAt: at }).where(eq(lessons.id, id));
              yield* bumpSubject(tx, yield* lessonSubject(tx, row), at);
            }),
          )
          .pipe(mapRepoError("set lesson status")),

      setExerciseStatus: (id, status) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* exerciseRow(tx, id);
              const at = iso(yield* DateTime.now);
              yield* tx
                .update(exercises)
                .set({ status, updatedAt: at })
                .where(eq(exercises.id, id));
              yield* bumpSubject(tx, yield* exerciseSubject(tx, row), at);
            }),
          )
          .pipe(mapRepoError("set exercise status")),

      replaceSkills: (subjectId, skills) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* subjectRow(tx, subjectId);
              const at = iso(yield* DateTime.now);
              yield* tx.delete(subjectSkills).where(eq(subjectSkills.subjectId, subjectId));
              if (skills.length === 0) {
                yield* bumpSubject(tx, subjectId, at);
                return [] as ReadonlyArray<Skill>;
              }
              const rows = yield* tx
                .insert(subjectSkills)
                .values(
                  skills.map((skill) => ({
                    id: rowId(),
                    subjectId,
                    kind: skill.kind,
                    text: skill.text,
                    sourceThreadId: skill.sourceThreadId ?? null,
                  })),
                )
                .returning();
              yield* bumpSubject(tx, subjectId, at);
              return rows.map(toSkill);
            }),
          )
          .pipe(mapRepoError("replace skills")),

      rewriteNote: (subjectId, note) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* subjectRow(tx, subjectId);
              const at = iso(yield* DateTime.now);
              yield* tx
                .insert(subjectNoteRevisions)
                .values({ id: rowId(), subjectId, note: row.note, replacedAt: at });
              yield* tx
                .update(subjects)
                .set({ note, updatedAt: at })
                .where(eq(subjects.id, subjectId));
            }),
          )
          .pipe(mapRepoError("rewrite note")),

      note: (subjectId) =>
        db.query.subjects.findFirst({ where: { id: subjectId }, columns: { note: true } }).pipe(
          Effect.mapError(fail("read note")),
          Effect.flatMap((row) =>
            row === undefined ? new SubjectNotFound({ subjectId }) : Effect.succeed(row.note),
          ),
        ),

      memory: (subjectId) =>
        Effect.gen(function* () {
          const subject = yield* db.query.subjects.findFirst({ where: { id: subjectId } });
          if (subject === undefined) return yield* new SubjectNotFound({ subjectId });
          const skills = yield* db.query.subjectSkills.findMany({ where: { subjectId } });
          return new SubjectMemory({
            subject: toSubject(subject),
            note: subject.note,
            skills: skills.map(toSkill),
            chapters: yield* outlineChapters(subjectId),
          });
        }).pipe(mapRepoError("read memory")),

      exercise: (id) =>
        db.query.exercises.findFirst({ where: { id } }).pipe(
          Effect.mapError(fail("get exercise")),
          Effect.flatMap((row) =>
            row === undefined
              ? new ExerciseNotFound({ exerciseId: id })
              : Effect.succeed(toExercise(row)),
          ),
        ),

      anchorThread: (threadId, anchor) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const columns = yield* Anchor.$match(anchor, {
                Subject: ({ subjectId }) =>
                  Effect.map(subjectRow(tx, subjectId), () => ({
                    subjectId,
                    chapterId: null,
                    lessonId: null,
                    exerciseId: null,
                  })),
                Chapter: ({ chapterId }) =>
                  Effect.map(chapterRow(tx, chapterId), (chapter) => ({
                    subjectId: chapter.subjectId,
                    chapterId,
                    lessonId: null,
                    exerciseId: null,
                  })),
                Lesson: ({ lessonId }) =>
                  Effect.gen(function* () {
                    const lesson = yield* lessonRow(tx, lessonId);
                    return {
                      subjectId: yield* lessonSubject(tx, lesson),
                      chapterId: null,
                      lessonId,
                      exerciseId: null,
                    };
                  }),
                Exercise: ({ exerciseId }) =>
                  Effect.gen(function* () {
                    const exercise = yield* exerciseRow(tx, exerciseId);
                    return {
                      subjectId: yield* exerciseSubject(tx, exercise),
                      chapterId: null,
                      lessonId: null,
                      exerciseId,
                    };
                  }),
              });
              const rows = yield* tx
                .update(threads)
                .set(columns)
                .where(eq(threads.id, threadId))
                .returning({ id: threads.id });
              if (rows.length === 0) {
                return yield* new ThreadNotFound({ threadId });
              }
            }),
          )
          .pipe(mapRepoError("anchor thread")),

      anchorsOf: (threadId) =>
        db.query.threads
          .findFirst({
            where: { id: threadId },
            columns: { subjectId: true, chapterId: true, lessonId: true, exerciseId: true },
          })
          .pipe(
            Effect.map((row) => Option.map(Option.fromUndefinedOr(row), toAnchors)),
            Effect.mapError(fail("read anchors")),
          ),

      threadsOf: (subjectId) =>
        db.query.threads.findMany({ where: { subjectId }, orderBy: { updatedAt: "desc" } }).pipe(
          Effect.map((rows) =>
            rows.map(
              (row) =>
                new AnchoredThread({
                  id: row.id as ThreadId,
                  title: row.title,
                  updatedAt: utc(row.updatedAt),
                  anchors: toAnchors(row),
                }),
            ),
          ),
          Effect.mapError(fail("list subject threads")),
        ),

      newestThreadOf: (exerciseId) =>
        db.query.threads.findFirst({ where: { exerciseId }, orderBy: { updatedAt: "desc" } }).pipe(
          Effect.map((row) =>
            Option.map(Option.fromUndefinedOr(row), (thread) => thread.id as ThreadId),
          ),
          Effect.mapError(fail("newest exercise thread")),
        ),
    };

    return Service.of(service);
  }),
);

type SubjectRow = typeof subjects.$inferSelect;
type ChapterRow = typeof chapters.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;
type ExerciseRow = typeof exercises.$inferSelect;
type SkillRow = typeof subjectSkills.$inferSelect;

interface ThreadAnchorRow {
  readonly id: string;
  readonly title: string | null;
  readonly updatedAt: string;
  readonly subjectId: string | null;
  readonly chapterId: string | null;
  readonly lessonId: string | null;
  readonly exerciseId: string | null;
}

interface Store {
  readonly subjects: Map<string, SubjectRow>;
  readonly chapters: Map<string, ChapterRow>;
  readonly lessons: Map<string, LessonRow>;
  readonly exercises: Map<string, ExerciseRow>;
  readonly skills: Map<string, SkillRow>;
  readonly revisions: Array<{ subjectId: string; note: string; replacedAt: string }>;
  /**
   * Anchor records only — threads themselves live in chat's repo. Anchoring a
   * thread this layer has not seen upserts a record instead of failing, since
   * the memory layers of the two domains do not share a store.
   */
  readonly threads: Map<string, ThreadAnchorRow>;
}

/** In-memory implementation for scratch scripts and tests. Requires nothing. */
export const memory = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* Ref.make<Store>({
      subjects: new Map(),
      chapters: new Map(),
      lessons: new Map(),
      exercises: new Map(),
      skills: new Map(),
      revisions: [],
      threads: new Map(),
    });

    const nowIso = Effect.map(DateTime.now, iso);

    const use = <A, E>(f: (state: Store, at: string) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const at = yield* nowIso;
        return yield* f(yield* Ref.get(store), at);
      });

    const subjectRow = (state: Store, id: SubjectId) =>
      state.subjects.get(id) === undefined
        ? new SubjectNotFound({ subjectId: id })
        : Effect.succeed(state.subjects.get(id)!);
    const chapterRow = (state: Store, id: ChapterId) =>
      state.chapters.get(id) === undefined
        ? new ChapterNotFound({ chapterId: id })
        : Effect.succeed(state.chapters.get(id)!);
    const lessonRow = (state: Store, id: LessonId) =>
      state.lessons.get(id) === undefined
        ? new LessonNotFound({ lessonId: id })
        : Effect.succeed(state.lessons.get(id)!);
    const exerciseRow = (state: Store, id: ExerciseId) =>
      state.exercises.get(id) === undefined
        ? new ExerciseNotFound({ exerciseId: id })
        : Effect.succeed(state.exercises.get(id)!);

    const lessonSubject = (state: Store, row: LessonRow) =>
      Effect.map(chapterRow(state, row.chapterId as ChapterId), (chapter) => chapter.subjectId);
    const exerciseSubject = (state: Store, row: ExerciseRow) =>
      Effect.flatMap(lessonRow(state, row.lessonId as LessonId), (lesson) =>
        lessonSubject(state, lesson),
      );

    const ordered = <Row extends { position: number }>(
      rows: Iterable<Row>,
      filter: (row: Row) => boolean,
    ) => [...rows].filter(filter).sort((a, b) => a.position - b.position);

    const renumber = <Row extends { id: string; position: number }>(
      map: Map<string, Row>,
      ids: ReadonlyArray<string>,
    ) => {
      ids.forEach((id, index) => {
        const row = map.get(id);
        if (row) map.set(id, { ...row, position: index + 1 });
      });
    };

    const bump = (state: Store, subjectId: string, at: string) => {
      const subject = state.subjects.get(subjectId);
      if (subject) state.subjects.set(subjectId, { ...subject, updatedAt: at });
    };

    const chapterSiblings = (state: Store, subjectId: string) =>
      ordered(state.chapters.values(), (row) => row.subjectId === subjectId).map((row) => row.id);
    const lessonSiblings = (state: Store, chapterId: string) =>
      ordered(state.lessons.values(), (row) => row.chapterId === chapterId).map((row) => row.id);
    const exerciseSiblings = (state: Store, lessonId: string) =>
      ordered(state.exercises.values(), (row) => row.lessonId === lessonId).map((row) => row.id);

    const outlineOf = (state: Store, subjectId: string): ReadonlyArray<OutlineChapter> =>
      ordered(state.chapters.values(), (row) => row.subjectId === subjectId).map(
        (chapter) =>
          new OutlineChapter({
            ...toChapter(chapter),
            lessons: ordered(state.lessons.values(), (row) => row.chapterId === chapter.id).map(
              (lesson) =>
                new OutlineLesson({
                  ...toLesson(lesson),
                  exercises: ordered(
                    state.exercises.values(),
                    (row) => row.lessonId === lesson.id,
                  ).map(toExercise),
                }),
            ),
          }),
      );

    const service: Interface = {
      create: (subject) =>
        use((state, at) =>
          Effect.sync(() => {
            const row: SubjectRow = {
              id: subject.id,
              title: subject.title,
              about: subject.about ?? "",
              motivation: subject.motivation ?? "",
              dueAt: isoOrNull(subject.dueAt),
              note: "",
              createdAt: at,
              updatedAt: at,
            };
            state.subjects.set(subject.id, row);
            return toSubject(row);
          }),
        ),

      get: (id) =>
        use((state) =>
          Effect.succeed(Option.map(Option.fromUndefinedOr(state.subjects.get(id)), toSubject)),
        ),

      list: use((state) =>
        Effect.succeed(
          [...state.subjects.values()]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(toSubject),
        ),
      ),

      update: (id, patch) =>
        use((state, at) =>
          Effect.map(subjectRow(state, id), (row) => {
            const next: SubjectRow = {
              ...row,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.about !== undefined ? { about: patch.about } : {}),
              ...(patch.motivation !== undefined ? { motivation: patch.motivation } : {}),
              ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
              updatedAt: at,
            };
            state.subjects.set(id, next);
            return toSubject(next);
          }),
        ),

      outline: (id) =>
        use((state) =>
          Effect.map(
            subjectRow(state, id),
            (row) => new Outline({ subject: toSubject(row), chapters: outlineOf(state, id) }),
          ),
        ),

      insertChapter: (subjectId, chapter) =>
        use((state, at) =>
          Effect.map(subjectRow(state, subjectId), () => {
            const row: ChapterRow = {
              id: chapter.id,
              subjectId,
              position: 0,
              title: chapter.title,
              summary: chapter.summary ?? "",
              dueAt: isoOrNull(chapter.dueAt),
              createdAt: at,
              updatedAt: at,
            };
            state.chapters.set(chapter.id, row);
            renumber(
              state.chapters,
              placed(
                chapterSiblings(state, subjectId).filter((id) => id !== chapter.id),
                chapter.id,
                chapter.at,
              ),
            );
            bump(state, subjectId, at);
            return toChapter(state.chapters.get(chapter.id)!);
          }),
        ),

      updateChapter: (id, patch) =>
        use((state, at) =>
          Effect.map(chapterRow(state, id), (row) => {
            const next: ChapterRow = {
              ...row,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
              ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
              updatedAt: at,
            };
            state.chapters.set(id, next);
            bump(state, row.subjectId, at);
            return toChapter(next);
          }),
        ),

      moveChapter: (id, to) =>
        use((state, at) =>
          Effect.map(chapterRow(state, id), (row) => {
            renumber(
              state.chapters,
              placed(
                chapterSiblings(state, row.subjectId).filter((s) => s !== id),
                id,
                to,
              ),
            );
            bump(state, row.subjectId, at);
          }),
        ),

      removeChapter: (id) =>
        use((state, at) =>
          Effect.map(chapterRow(state, id), (row) => {
            state.chapters.delete(id);
            for (const lesson of [...state.lessons.values()]) {
              if (lesson.chapterId !== id) continue;
              state.lessons.delete(lesson.id);
              for (const exercise of [...state.exercises.values()]) {
                if (exercise.lessonId === lesson.id) state.exercises.delete(exercise.id);
              }
            }
            renumber(state.chapters, chapterSiblings(state, row.subjectId));
            bump(state, row.subjectId, at);
          }),
        ),

      insertLesson: (chapterId, lesson) =>
        use((state, at) =>
          Effect.map(chapterRow(state, chapterId), (chapter) => {
            const row: LessonRow = {
              id: lesson.id,
              chapterId,
              position: 0,
              title: lesson.title,
              status: "not_started",
              documentId: lesson.documentId,
              dueAt: isoOrNull(lesson.dueAt),
              createdAt: at,
              updatedAt: at,
            };
            state.lessons.set(lesson.id, row);
            renumber(
              state.lessons,
              placed(
                lessonSiblings(state, chapterId).filter((id) => id !== lesson.id),
                lesson.id,
                lesson.at,
              ),
            );
            bump(state, chapter.subjectId, at);
            return toLesson(state.lessons.get(lesson.id)!);
          }),
        ),

      updateLesson: (id, patch) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* lessonRow(state, id);
            const next: LessonRow = {
              ...row,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.dueAt !== undefined ? { dueAt: isoOrNull(patch.dueAt) } : {}),
              updatedAt: at,
            };
            state.lessons.set(id, next);
            bump(state, yield* lessonSubject(state, row), at);
            return toLesson(next);
          }),
        ),

      moveLesson: (id, to) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* lessonRow(state, id);
            renumber(
              state.lessons,
              placed(
                lessonSiblings(state, row.chapterId).filter((s) => s !== id),
                id,
                to,
              ),
            );
            bump(state, yield* lessonSubject(state, row), at);
          }),
        ),

      removeLesson: (id) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* lessonRow(state, id);
            const subjectId = yield* lessonSubject(state, row);
            state.lessons.delete(id);
            for (const exercise of [...state.exercises.values()]) {
              if (exercise.lessonId === id) state.exercises.delete(exercise.id);
            }
            renumber(state.lessons, lessonSiblings(state, row.chapterId));
            bump(state, subjectId, at);
          }),
        ),

      insertExercise: (lessonId, exercise) =>
        use((state, at) =>
          Effect.gen(function* () {
            const lesson = yield* lessonRow(state, lessonId);
            const row: ExerciseRow = {
              id: exercise.id,
              lessonId,
              position: 0,
              title: exercise.title,
              brief: exercise.brief,
              status: "not_started",
              createdAt: at,
              updatedAt: at,
            };
            state.exercises.set(exercise.id, row);
            renumber(
              state.exercises,
              placed(
                exerciseSiblings(state, lessonId).filter((id) => id !== exercise.id),
                exercise.id,
                exercise.at,
              ),
            );
            bump(state, yield* lessonSubject(state, lesson), at);
            return toExercise(state.exercises.get(exercise.id)!);
          }),
        ),

      updateExercise: (id, patch) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* exerciseRow(state, id);
            const next: ExerciseRow = {
              ...row,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
              updatedAt: at,
            };
            state.exercises.set(id, next);
            bump(state, yield* exerciseSubject(state, row), at);
            return toExercise(next);
          }),
        ),

      moveExercise: (id, to) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* exerciseRow(state, id);
            renumber(
              state.exercises,
              placed(
                exerciseSiblings(state, row.lessonId).filter((s) => s !== id),
                id,
                to,
              ),
            );
            bump(state, yield* exerciseSubject(state, row), at);
          }),
        ),

      removeExercise: (id) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* exerciseRow(state, id);
            const subjectId = yield* exerciseSubject(state, row);
            state.exercises.delete(id);
            renumber(state.exercises, exerciseSiblings(state, row.lessonId));
            bump(state, subjectId, at);
          }),
        ),

      setLessonStatus: (id, status) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* lessonRow(state, id);
            state.lessons.set(id, { ...row, status, updatedAt: at });
            bump(state, yield* lessonSubject(state, row), at);
          }),
        ),

      setExerciseStatus: (id, status) =>
        use((state, at) =>
          Effect.gen(function* () {
            const row = yield* exerciseRow(state, id);
            state.exercises.set(id, { ...row, status, updatedAt: at });
            bump(state, yield* exerciseSubject(state, row), at);
          }),
        ),

      replaceSkills: (subjectId, skills) =>
        use((state, at) =>
          Effect.map(subjectRow(state, subjectId), () => {
            for (const skill of [...state.skills.values()]) {
              if (skill.subjectId === subjectId) state.skills.delete(skill.id);
            }
            const rows = skills.map((skill): SkillRow => ({
              id: rowId(),
              subjectId,
              kind: skill.kind,
              text: skill.text,
              sourceThreadId: skill.sourceThreadId ?? null,
              createdAt: at,
              updatedAt: at,
            }));
            for (const row of rows) state.skills.set(row.id, row);
            bump(state, subjectId, at);
            return rows.map(toSkill);
          }),
        ),

      rewriteNote: (subjectId, note) =>
        use((state, at) =>
          Effect.map(subjectRow(state, subjectId), (row) => {
            state.revisions.push({ subjectId, note: row.note, replacedAt: at });
            state.subjects.set(subjectId, { ...row, note, updatedAt: at });
          }),
        ),

      note: (subjectId) =>
        use((state) => Effect.map(subjectRow(state, subjectId), (row) => row.note)),

      memory: (subjectId) =>
        use((state) =>
          Effect.map(
            subjectRow(state, subjectId),
            (row) =>
              new SubjectMemory({
                subject: toSubject(row),
                note: row.note,
                skills: [...state.skills.values()]
                  .filter((skill) => skill.subjectId === subjectId)
                  .map(toSkill),
                chapters: outlineOf(state, subjectId),
              }),
          ),
        ),

      exercise: (id) => use((state) => Effect.map(exerciseRow(state, id), toExercise)),

      anchorThread: (threadId, anchor) =>
        use((state, at) =>
          Effect.gen(function* () {
            const columns = yield* Anchor.$match(anchor, {
              Subject: ({ subjectId }) =>
                Effect.map(subjectRow(state, subjectId), () => ({
                  subjectId: subjectId as string,
                  chapterId: null,
                  lessonId: null,
                  exerciseId: null,
                })),
              Chapter: ({ chapterId }) =>
                Effect.map(chapterRow(state, chapterId), (chapter) => ({
                  subjectId: chapter.subjectId,
                  chapterId: chapterId as string | null,
                  lessonId: null,
                  exerciseId: null,
                })),
              Lesson: ({ lessonId }) =>
                Effect.gen(function* () {
                  const lesson = yield* lessonRow(state, lessonId);
                  return {
                    subjectId: yield* lessonSubject(state, lesson),
                    chapterId: null,
                    lessonId: lessonId as string | null,
                    exerciseId: null,
                  };
                }),
              Exercise: ({ exerciseId }) =>
                Effect.gen(function* () {
                  const exercise = yield* exerciseRow(state, exerciseId);
                  return {
                    subjectId: yield* exerciseSubject(state, exercise),
                    chapterId: null,
                    lessonId: null,
                    exerciseId: exerciseId as string | null,
                  };
                }),
            });
            const existing = state.threads.get(threadId);
            state.threads.set(threadId, {
              id: threadId,
              title: existing?.title ?? null,
              updatedAt: at,
              subjectId: columns.subjectId,
              chapterId: columns.chapterId,
              lessonId: columns.lessonId,
              exerciseId: columns.exerciseId,
            });
          }),
        ),

      anchorsOf: (threadId) =>
        use((state) =>
          Effect.succeed(
            Option.map(Option.fromUndefinedOr(state.threads.get(threadId)), toAnchors),
          ),
        ),

      threadsOf: (subjectId) =>
        use((state) =>
          Effect.succeed(
            [...state.threads.values()]
              .filter((row) => row.subjectId === subjectId)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map(
                (row) =>
                  new AnchoredThread({
                    id: row.id as ThreadId,
                    title: row.title,
                    updatedAt: utc(row.updatedAt),
                    anchors: toAnchors(row),
                  }),
              ),
          ),
        ),

      newestThreadOf: (exerciseId) =>
        use((state) =>
          Effect.succeed(
            Option.map(
              Option.fromUndefinedOr(
                [...state.threads.values()]
                  .filter((row) => row.exerciseId === exerciseId)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
              ),
              (row) => row.id as ThreadId,
            ),
          ),
        ),
    };

    return Service.of(service);
  }),
);

export * as SubjectRepo from "./repo";
