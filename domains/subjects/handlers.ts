import type * as Alchemy from "alchemy";
import { Documents } from "@erudane/documents/service";
import * as Effect from "effect/Effect";
import type { ExerciseNotFound, LessonNotFound, RepoError } from "./errors";
import { Subjects } from "./service";
import { SubjectTools } from "./tools";

/**
 * Every failure reaches the model as `{ message }` so it can correct course.
 * Tagged errors carry their detail in fields, not `message` — serialize them,
 * so `SubjectNotFound` reads as `…: {"subjectId":"…"}` instead of a bare tag.
 */
const toFailure = (error: { readonly _tag: string; readonly message?: string }) => {
  const hidden = new Set(["_tag", "message", "cause", "stack"]);
  const fields = Object.fromEntries(
    Object.entries(error).filter(([key, value]) => !hidden.has(key) && typeof value !== "function"),
  );
  const detail =
    error.message !== undefined && error.message.length > 0
      ? error.message
      : Object.keys(fields).length > 0
        ? JSON.stringify(fields)
        : "";
  return Effect.fail({ message: detail.length > 0 ? `${error._tag}: ${detail}` : error._tag });
};

/**
 * The toolkit's handler type demands a closed requirement channel, but these
 * handlers execute inside the request fiber, where `Alchemy.RuntimeContext` (the
 * worker's ambient per-request context) is always present — erased here, found
 * at runtime.
 */
const ambient = <A, E>(effect: Effect.Effect<A, E, Alchemy.RuntimeContext>): Effect.Effect<A, E> =>
  effect as unknown as Effect.Effect<A, E>;

/** Handler layer for the subject tools; the agent side of the one write path. */
export const layer = SubjectTools.toolkit.toLayer(
  Effect.gen(function* () {
    const subjects = yield* Subjects.Service;
    const documents = yield* Documents.Service;

    return SubjectTools.toolkit.of({
      CreateSubject: (input) =>
        subjects.create(input).pipe(
          Effect.map((outline) => ({ outline })),
          Effect.catch(toFailure),
          ambient,
        ),

      UpdateSubject: ({ subjectId, ...patch }) =>
        subjects.update(subjectId, patch).pipe(
          Effect.map((subject) => ({ subject })),
          Effect.catch(toFailure),
          ambient,
        ),

      EditOutline: ({ subjectId, ops }) =>
        subjects.editOutline(subjectId, ops).pipe(
          Effect.map((outline) => ({ outline })),
          Effect.catch(toFailure),
          ambient,
        ),

      SetStatus: ({ lessonId, exerciseId, status }) => {
        if (lessonId === undefined && exerciseId === undefined) {
          return Effect.fail({ message: "Pass exactly one of lessonId / exerciseId." });
        }
        const action: Effect.Effect<
          void,
          LessonNotFound | ExerciseNotFound | RepoError,
          Alchemy.RuntimeContext
        > =
          lessonId !== undefined
            ? subjects.setLessonStatus(lessonId, status)
            : subjects.setExerciseStatus(exerciseId!, status);
        return action.pipe(
          Effect.map(() => ({ updated: true as const })),
          Effect.catch(toFailure),
          ambient,
        );
      },

      SaveNote: ({ subjectId, note }) =>
        subjects.rewriteNote(subjectId, note).pipe(
          Effect.map(() => ({ saved: true as const })),
          Effect.catch(toFailure),
          ambient,
        ),

      UpdateSkills: ({ subjectId, strengths, weaknesses }) =>
        subjects
          .replaceSkills(subjectId, [
            ...strengths.map((text) => ({ kind: "strength" as const, text })),
            ...weaknesses.map((text) => ({ kind: "weakness" as const, text })),
          ])
          .pipe(
            Effect.map(() => ({ saved: true as const })),
            Effect.catch(toFailure),
            ambient,
          ),

      CreateExercise: ({ lessonId, title, brief, at }) =>
        subjects.addExercise(lessonId, { title, brief, at }).pipe(
          Effect.map((exercise) => ({ exerciseId: exercise.id })),
          Effect.catch(toFailure),
          ambient,
        ),

      ReadDocument: ({ documentId }) =>
        documents.read(documentId).pipe(
          Effect.map((markdown) => ({ markdown })),
          Effect.catch(toFailure),
        ),

      EditDocument: ({ documentId, ops }) =>
        documents.edit(documentId, ops).pipe(
          Effect.flatMap(() => documents.read(documentId)),
          Effect.map((markdown) => ({ markdown })),
          Effect.catch(toFailure),
        ),
    });
  }),
);

export * as SubjectHandlers from "./handlers";
