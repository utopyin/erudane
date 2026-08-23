import type { Db } from "@erudane/db/service";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";
import type { ChatError, RepoError, ThreadNotFound } from "./errors";
import * as Ids from "./ids";
import { Chat } from "./service";
import { ThreadRepo } from "./threads";
import type { ChatEvent, MessageId, NewMessage, RunInput, ThreadId } from "./types";

/** One persisted run on a thread: load history, store the user message, stream, store the result. */
export interface Interface {
  readonly start: (
    input: RunInput,
  ) => Stream.Stream<ChatEvent, ChatError | ThreadNotFound | RepoError, Db.Runtime>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Db.Runtime` is the worker's per-request context, carried by the repository.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/chat/Run") {}

interface Step {
  readonly messageId: MessageId;
  readonly parts: Array<Response.StreamPart<any>>;
}

/** What a finished run stores: per step, the assistant message and (if tools ran) the tool message. */
const toMessages = (steps: ReadonlyArray<Step>): Effect.Effect<ReadonlyArray<NewMessage>> =>
  Effect.forEach(steps, (step) =>
    Effect.forEach(
      Prompt.fromResponseParts(step.parts).content,
      (message): Effect.Effect<NewMessage> =>
        message.role === "assistant"
          ? Effect.succeed({ id: step.messageId, message })
          : Effect.map(Ids.messageId, (id) => ({ id, message })),
    ),
  ).pipe(Effect.map((nested) => nested.flat()));

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const chat = yield* Chat.Service;
    const repo = yield* ThreadRepo.Service;

    const persist = (threadId: ThreadId, steps: ReadonlyArray<Step>) =>
      Effect.flatMap(toMessages(steps), (items) =>
        items.length === 0 ? Effect.void : Effect.asVoid(repo.append(threadId, items)),
      );

    const start: Interface["start"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const history = yield* repo.messages(input.threadId);
          const userId = yield* Ids.messageId;
          yield* repo.append(input.threadId, [{ id: userId, message: input.message }]);

          const steps: Array<Step> = [];
          const collect = (event: ChatEvent) =>
            Effect.sync(() => {
              if (event._tag === "StepStart") {
                steps.push({ messageId: event.messageId as MessageId, parts: [] });
              } else if (event._tag === "Part") {
                steps[steps.length - 1]?.parts.push(event.part);
              }
            });

          return chat
            .stream({
              messages: [...history.map((stored) => stored.message), input.message],
              system: input.system,
              maxSteps: input.maxSteps,
            })
            .pipe(
              Stream.tap(collect),
              // After a successful end only: a failed or stopped run keeps just the user message.
              Stream.onEnd(Effect.suspend(() => persist(input.threadId, steps))),
            );
        }),
      );

    return Service.of({ start });
  }),
);

export * as Run from "./run";
