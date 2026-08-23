import type { RepoError as ChatRepoError, ThreadNotFound } from "@erudane/chat/errors";
import * as ChatIds from "@erudane/chat/ids";
import { ThreadRepo } from "@erudane/chat/threads";
import type { ThreadId } from "@erudane/chat/types";
import type { Database } from "@erudane/db/service";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Prompt from "effect/unstable/ai/Prompt";
import type {
  ChapterNotFound,
  ExerciseNotFound,
  LessonNotFound,
  RepoError,
  SubjectNotFound,
} from "./errors";
import { SubjectRepo } from "./repo";
import { Anchor, type ExerciseId } from "./types";

type Errors =
  | RepoError
  | SubjectNotFound
  | ChapterNotFound
  | LessonNotFound
  | ExerciseNotFound
  | ChatRepoError
  | ThreadNotFound;

/**
 * An exercise is an agent-led thread: starting one creates a thread anchored
 * to the exercise, seeded with an assistant message rendered from the
 * agent-authored `brief` — the user lands in a conversation already begun.
 * Deterministic, no model call: the agent wrote `brief` when it created the
 * exercise; a generated opener would couple start to model availability.
 */
export interface Interface {
  /** Idempotent: an exercise that already has a thread returns the newest one. */
  readonly start: (
    exerciseId: ExerciseId,
  ) => Effect.Effect<{ readonly threadId: ThreadId }, Errors, Database.Runtime>;
  /** Always opens a fresh thread — retries are N threads per exercise. */
  readonly restart: (
    exerciseId: ExerciseId,
  ) => Effect.Effect<{ readonly threadId: ThreadId }, Errors, Database.Runtime>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Database.Runtime` is the worker's per-request context; queries open their pool on it.
 */
export class Service extends Context.Service<Service, Interface>()(
  "@erudane/subjects/ExerciseRuns",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const subjects = yield* SubjectRepo.Service;
    const threads = yield* ThreadRepo.Service;

    const open: Interface["restart"] = (exerciseId) =>
      Effect.gen(function* () {
        const exercise = yield* subjects.exercise(exerciseId);
        const threadId = yield* ChatIds.threadId;
        yield* threads.create({ id: threadId, title: exercise.title });
        yield* subjects.anchorThread(threadId, Anchor.Exercise({ exerciseId }));
        yield* threads.append(threadId, [
          {
            id: yield* ChatIds.messageId,
            message: Prompt.makeMessage("assistant", {
              content: [Prompt.makePart("text", { text: exercise.brief })],
            }),
          },
        ]);
        yield* subjects.setExerciseStatus(exerciseId, "in_progress");
        return { threadId };
      });

    return Service.of({
      start: (exerciseId) =>
        Effect.gen(function* () {
          const existing = yield* subjects.newestThreadOf(exerciseId);
          if (Option.isSome(existing)) return { threadId: existing.value };
          return yield* open(exerciseId);
        }),
      restart: open,
    });
  }),
);

export * as ExerciseRuns from "./exercises";
