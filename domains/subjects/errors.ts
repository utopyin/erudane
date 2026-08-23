import * as Schema from "effect/Schema";
import { ChapterId, ExerciseId, LessonId, SubjectId } from "./types";

export class SubjectNotFound extends Schema.TaggedError<SubjectNotFound>()(
  "Subjects.SubjectNotFound",
  { subjectId: SubjectId },
) {}

export class ChapterNotFound extends Schema.TaggedError<ChapterNotFound>()(
  "Subjects.ChapterNotFound",
  { chapterId: ChapterId },
) {}

export class LessonNotFound extends Schema.TaggedError<LessonNotFound>()(
  "Subjects.LessonNotFound",
  {
    lessonId: LessonId,
  },
) {}

export class ExerciseNotFound extends Schema.TaggedError<ExerciseNotFound>()(
  "Subjects.ExerciseNotFound",
  { exerciseId: ExerciseId },
) {}

/** A thread anchor that does not resolve: deep anchor from another subject, or more than one deep anchor. */
export class InvalidAnchor extends Schema.TaggedError<InvalidAnchor>()("Subjects.InvalidAnchor", {
  reason: Schema.String,
}) {}

/** Storage failure at the repository seam; the cause is the driver's error. */
export class RepoError extends Schema.TaggedError<RepoError>()("Subjects.RepoError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
