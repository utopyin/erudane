import * as Schema from "effect/Schema";

export const SubjectId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("SubjectId"));
export type SubjectId = typeof SubjectId.Type;

export const ChapterId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ChapterId"));
export type ChapterId = typeof ChapterId.Type;

export const LessonId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("LessonId"));
export type LessonId = typeof LessonId.Type;

export const ExerciseId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ExerciseId"));
export type ExerciseId = typeof ExerciseId.Type;

/** Progress of a lesson or an exercise; set by the user (rpc) or the agent (tool). */
export const ItemStatus = Schema.Literals(["not_started", "in_progress", "done"]);
export type ItemStatus = typeof ItemStatus.Type;

/** Something the user is good at (strength) or needs to deepen (weakness). */
export const SkillKind = Schema.Literals(["strength", "weakness"]);
export type SkillKind = typeof SkillKind.Type;
