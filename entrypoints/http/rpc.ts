import * as Ids from "@erudane/chat/ids";
import { ThreadRpcs } from "@erudane/chat/rpc";
import { ThreadRepo } from "@erudane/chat/threads";
import type { Database } from "@erudane/db/service";
import { Documents } from "@erudane/documents/service";
import { DocumentNotFound } from "@erudane/documents/errors";
import { ExerciseRuns } from "@erudane/subjects/exercises";
import { SubjectRpcs } from "@erudane/subjects/rpc";
import { Subjects } from "@erudane/subjects/service";
import { SubjectNotFound } from "@erudane/subjects/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

const DEFAULT_LIMIT = 50;

const group = ThreadRpcs.merge(SubjectRpcs);

/**
 * Handler requirements become build-time layer requirements, but
 * `Database.Runtime` is the worker's ambient per-request context — the rpc
 * request fiber always carries it. Erased from the type, found at runtime
 * (same posture as the tool handlers).
 */
const ambient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Database.Runtime>> =>
  effect as unknown as Effect.Effect<A, E, Exclude<R, Database.Runtime>>;

const handlers = group.toLayer({
  "threads.list": ({ limit }) =>
    ambient(
      Effect.gen(function* () {
        const repo = yield* ThreadRepo.Service;
        return yield* repo.list({ limit: limit ?? DEFAULT_LIMIT });
      }),
    ),
  "threads.create": ({ title }) =>
    ambient(
      Effect.gen(function* () {
        const repo = yield* ThreadRepo.Service;
        return yield* repo.create({ id: yield* Ids.threadId, title });
      }),
    ),

  "subjects.list": () =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).list;
      }),
    ),
  "subjects.get": ({ id }) =>
    ambient(
      Effect.gen(function* () {
        const subjects = yield* Subjects.Service;
        const subject = yield* subjects.get(id);
        if (Option.isNone(subject)) return yield* new SubjectNotFound({ subjectId: id });
        return subject.value;
      }),
    ),
  "subjects.create": (input) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).create(input);
      }),
    ),
  "subjects.update": ({ id, ...patch }) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).update(id, patch);
      }),
    ),
  "subjects.outline": ({ id }) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).outline(id);
      }),
    ),
  "subjects.editOutline": ({ id, ops }) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).editOutline(id, ops);
      }),
    ),
  "subjects.setStatus": ({ lessonId, exerciseId, status }) =>
    ambient(
      Effect.gen(function* () {
        const subjects = yield* Subjects.Service;
        if (lessonId !== undefined) return yield* subjects.setLessonStatus(lessonId, status);
        if (exerciseId !== undefined) return yield* subjects.setExerciseStatus(exerciseId, status);
      }),
    ),
  "subjects.threads": ({ id }) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).threadsOf(id);
      }),
    ),
  "subjects.note": ({ id }) =>
    ambient(
      Effect.gen(function* () {
        return yield* (yield* Subjects.Service).note(id);
      }),
    ),

  "exercises.start": ({ id, restart }) =>
    ambient(
      Effect.gen(function* () {
        const runs = yield* ExerciseRuns.Service;
        return yield* restart === true ? runs.restart(id) : runs.start(id);
      }),
    ),

  "documents.get": ({ id }) =>
    ambient(
      Effect.gen(function* () {
        const documents = yield* Documents.Service;
        const meta = yield* documents.get(id);
        if (Option.isNone(meta)) return yield* new DocumentNotFound({ documentId: id });
        return meta.value;
      }),
    ),
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
