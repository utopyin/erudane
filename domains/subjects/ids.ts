import { DocumentId } from "@erudane/documents/types";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { ChapterId, ExerciseId, LessonId, SubjectId } from "./types";

/**
 * Id minting, resolved once when a layer is built: `const ids = yield* Ids.make`.
 * A failed random source is a defect, not something callers can handle.
 */
export const make = Crypto.Crypto.useSync((crypto) => {
  const uuid = Effect.orDie(crypto.randomUUIDv4);
  return {
    subjectId: Effect.map(uuid, (id) => SubjectId.make(id)),
    chapterId: Effect.map(uuid, (id) => ChapterId.make(id)),
    lessonId: Effect.map(uuid, (id) => LessonId.make(id)),
    exerciseId: Effect.map(uuid, (id) => ExerciseId.make(id)),
    /** A lesson's document is minted by this domain — created together, 1:1. */
    documentId: Effect.map(uuid, (id) => DocumentId.make(id)),
  };
});
