import type { Database } from "@erudane/db/service";
import { Documents } from "@erudane/documents/service";
import * as Effect from "effect/Effect";
import { Subjects } from "./service";
import { SubjectTools } from "./tools";

/** Every failure reaches the model as `{ message }` so it can correct course. */
const toFailure = (error: { readonly _tag: string; readonly message?: string }) =>
  Effect.fail({
    message: `${error._tag}${error.message !== undefined ? `: ${error.message}` : ""}`,
  });

/**
 * The toolkit's handler type demands a closed requirement channel, but these
 * handlers execute inside the request fiber, where `Database.Runtime` (the
 * worker's ambient per-request context) is always present — erased here, found
 * at runtime.
 */
const ambient = <A, E>(effect: Effect.Effect<A, E, Database.Runtime>): Effect.Effect<A, E> =>
  effect as unknown as Effect.Effect<A, E>;

/** Handler layer for the subject tools; the agent side of the one write path. */
export const layer = SubjectTools.toolkit.toLayer(
  Effect.gen(function* () {
    const subjects = yield* Subjects.Service;
    const documents = yield* Documents.Service;

    return SubjectTools.toolkit.of({
      CreateSubject: (input) =>
        ambient(
          subjects.create(input).pipe(
            Effect.map((outline) => ({ outline })),
            Effect.catch(toFailure),
          ),
        ),

      UpdateSubject: ({ subjectId, ...patch }) =>
        ambient(
          subjects.update(subjectId, patch).pipe(
            Effect.map((subject) => ({ subject })),
            Effect.catch(toFailure),
          ),
        ),

      EditOutline: ({ subjectId, ops }) =>
        ambient(
          subjects.editOutline(subjectId, ops).pipe(
            Effect.map((outline) => ({ outline })),
            Effect.catch(toFailure),
          ),
        ),

      SetStatus: ({ lessonId, exerciseId, status }) => {
        if (lessonId === undefined && exerciseId === undefined) {
          return Effect.fail({ message: "Pass exactly one of lessonId / exerciseId." });
        }
        const action =
          lessonId !== undefined
            ? subjects.setLessonStatus(lessonId, status)
            : subjects.setExerciseStatus(exerciseId!, status);
        return ambient(
          action.pipe(
            Effect.map(() => ({ updated: true as const })),
            Effect.catch(toFailure),
          ),
        );
      },

      SaveNote: ({ subjectId, note }) =>
        ambient(
          subjects.rewriteNote(subjectId, note).pipe(
            Effect.map(() => ({ saved: true as const })),
            Effect.catch(toFailure),
          ),
        ),

      UpdateSkills: ({ subjectId, strengths, weaknesses }) =>
        ambient(
          subjects
            .replaceSkills(subjectId, [
              ...strengths.map((text) => ({ kind: "strength" as const, text })),
              ...weaknesses.map((text) => ({ kind: "weakness" as const, text })),
            ])
            .pipe(
              Effect.map(() => ({ saved: true as const })),
              Effect.catch(toFailure),
            ),
        ),

      CreateExercise: ({ lessonId, title, brief, at }) =>
        ambient(
          subjects.addExercise(lessonId, { title, brief, at }).pipe(
            Effect.map((exercise) => ({ exerciseId: exercise.id })),
            Effect.catch(toFailure),
          ),
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
