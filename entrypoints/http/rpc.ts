import type * as Alchemy from "alchemy";
import * as Ids from "@erudane/chat/ids";
import { ThreadRpcs } from "@erudane/chat/rpc";
import { ThreadRepo } from "@erudane/chat/threads";
import { Documents } from "@erudane/documents/service";
import { DocumentNotFound } from "@erudane/documents/errors";
import { ExerciseRuns } from "@erudane/subjects/exercises";
import { SubjectRpcs } from "@erudane/subjects/rpc";
import { Subjects } from "@erudane/subjects/service";
import {
  type ExerciseNotFound,
  type LessonNotFound,
  type RepoError,
  SubjectNotFound,
} from "@erudane/subjects/errors";
import { Anchor } from "@erudane/subjects/types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

const DEFAULT_LIMIT = 50;

const group = ThreadRpcs.merge(SubjectRpcs);

/**
 * Handler requirements become build-time layer requirements, but
 * `Alchemy.RuntimeContext` is the worker's ambient per-request context — the rpc
 * request fiber always carries it. Erased from the type, found at runtime
 * (same posture as the tool handlers).
 */
const ambient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Alchemy.RuntimeContext>> =>
  effect as unknown as Effect.Effect<A, E, Exclude<R, Alchemy.RuntimeContext>>;

const handlers = group.toLayer({
  "threads.list": ({ limit }) =>
    ThreadRepo.Service.use((repo) => repo.list({ limit: limit ?? DEFAULT_LIMIT })).pipe(ambient),
  "threads.create": ({ title }) =>
    Effect.gen(function* () {
      const repo = yield* ThreadRepo.Service;
      const ids = yield* Ids.make;
      return yield* repo.create({ id: yield* ids.threadId, title });
    }).pipe(ambient),

  "subjects.list": () => Subjects.Service.use(({ list }) => list).pipe(ambient),
  "subjects.get": ({ id }) =>
    Subjects.Service.use(({ get }) =>
      get(id).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => new SubjectNotFound({ subjectId: id }),
            onSome: Effect.succeed,
          }),
        ),
      ),
    ).pipe(ambient),
  "subjects.create": (input) => Subjects.Service.use(({ create }) => create(input)).pipe(ambient),
  "subjects.update": ({ id, ...patch }) =>
    Subjects.Service.use(({ update }) => update(id, patch)).pipe(ambient),
  "subjects.outline": ({ id }) => Subjects.Service.use(({ outline }) => outline(id)).pipe(ambient),
  "subjects.editOutline": ({ id, ops }) =>
    Subjects.Service.use(({ editOutline }) => editOutline(id, ops)).pipe(ambient),
  "subjects.setStatus": ({ lessonId, exerciseId, status }) =>
    Subjects.Service.use(
      (
        subjects,
      ): Effect.Effect<
        void,
        LessonNotFound | ExerciseNotFound | RepoError,
        Alchemy.RuntimeContext
      > =>
        lessonId !== undefined
          ? subjects.setLessonStatus(lessonId, status)
          : exerciseId !== undefined
            ? subjects.setExerciseStatus(exerciseId, status)
            : Effect.void,
    ).pipe(ambient),
  "subjects.threads": ({ id }) =>
    Subjects.Service.use(({ threadsOf }) => threadsOf(id)).pipe(ambient),
  "subjects.anchorThread": ({ threadId, subjectId, chapterId, lessonId, exerciseId }) => {
    const anchor =
      subjectId !== undefined
        ? Anchor.Subject({ subjectId })
        : chapterId !== undefined
          ? Anchor.Chapter({ chapterId })
          : lessonId !== undefined
            ? Anchor.Lesson({ lessonId })
            : exerciseId !== undefined
              ? Anchor.Exercise({ exerciseId })
              : undefined;
    return Subjects.Service.use(({ anchorThread }) =>
      anchor === undefined ? Effect.void : anchorThread(threadId, anchor),
    ).pipe(ambient);
  },

  "subjects.note": ({ id }) => Subjects.Service.use(({ note }) => note(id)).pipe(ambient),

  "exercises.start": ({ id, restart }) =>
    ExerciseRuns.Service.use((runs) => (restart === true ? runs.restart(id) : runs.start(id))).pipe(
      ambient,
    ),

  "documents.get": ({ id }) =>
    Documents.Service.use(({ get }) =>
      get(id).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => new DocumentNotFound({ documentId: id }),
            onSome: Effect.succeed,
          }),
        ),
      ),
    ).pipe(ambient),
});

/**
 * `POST /rpc` on the ambient router. `protocol: "http"` is explicit — the
 * default is websocket. ndjson so a future streaming rpc streams instead of
 * buffering.
 */
export const layer = RpcServer.layerHttp({ group, path: "/rpc", protocol: "http" }).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcSerialization.layerNdjson),
);
