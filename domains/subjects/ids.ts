import * as Effect from "effect/Effect";
import type { ChapterId, ExerciseId, LessonId, SubjectId } from "./types";

// @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- one id, no service worth requiring for it
const uuid = Effect.sync(() => crypto.randomUUID());

export const subjectId: Effect.Effect<SubjectId> = uuid as Effect.Effect<SubjectId>;
export const chapterId: Effect.Effect<ChapterId> = uuid as Effect.Effect<ChapterId>;
export const lessonId: Effect.Effect<LessonId> = uuid as Effect.Effect<LessonId>;
export const exerciseId: Effect.Effect<ExerciseId> = uuid as Effect.Effect<ExerciseId>;
