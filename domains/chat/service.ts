import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import * as Prompt from "effect/unstable/ai/Prompt";
import * as Response from "effect/unstable/ai/Response";
import type * as Schema from "effect/Schema";
import type * as Tool from "effect/unstable/ai/Tool";
import type * as ToolkitModule from "effect/unstable/ai/Toolkit";
import { ChatError } from "./errors.js";
import { ChatEvent, type ChatInput } from "./types.js";

const DEFAULT_MAX_STEPS = 5;

export interface Interface {
  /** One run: up to `maxSteps` model rounds, server tools resolved between rounds. */
  readonly stream: (input: ChatInput) => Stream.Stream<ChatEvent, ChatError>;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/chat/Chat") {}

type PlainSchema = Schema.Codec<any, any, never, never>;

/**
 * A tool the registry may contain: JSON-shaped schemas that need no services,
 * and no per-request requirements. Keeps the run's requirement channel closed
 * without the domain knowing the concrete registry.
 */
export type RegistryTool = Tool.Tool<
  string,
  {
    readonly parameters: PlainSchema;
    readonly success: PlainSchema;
    readonly failure: PlainSchema;
    readonly failureMode: Tool.FailureMode;
  },
  never
>;

/** The tool registry this domain talks to. Assembled and provided by an entrypoint. */
export class Toolkit extends Context.Service<
  Toolkit,
  ToolkitModule.WithHandler<Record<string, RegistryTool>>
>()("@erudane/chat/Toolkit") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel;
    const toolkit = yield* Toolkit;

    const step = (
      prompt: Prompt.Prompt,
      index: number,
      maxSteps: number,
    ): Stream.Stream<ChatEvent, ChatError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const parts: Array<Response.StreamPart<any>> = [];
          let finish: Response.FinishPart | undefined;

          const round = model.streamText({ prompt, toolkit, concurrency: 4 }).pipe(
            Stream.mapError((error) => ChatError.fromAiError(index, error)),
            Stream.tap((part) =>
              Effect.sync(() => {
                parts.push(part);
                if (part.type === "finish") finish = part;
              }),
            ),
            Stream.map((part) => ChatEvent.Part({ step: index, part })),
          );

          const after = Stream.suspend((): Stream.Stream<ChatEvent, ChatError> => {
            const end = ChatEvent.StepEnd({
              step: index,
              reason: finish?.reason ?? "unknown",
              usage: finish?.usage ?? new Response.Usage({ inputTokens: {}, outputTokens: {} }),
            });
            const calledTools = parts.some((part) => part.type === "tool-call");
            if (!calledTools) return Stream.make(end);
            if (index + 1 >= maxSteps) {
              return Stream.make(end, ChatEvent.MaxStepsReached({ step: index }));
            }
            const next = Prompt.concat(prompt, Prompt.fromResponseParts(parts));
            return Stream.concat(Stream.make(end), step(next, index + 1, maxSteps));
          });

          return Stream.make(ChatEvent.StepStart({ step: index })).pipe(
            Stream.concat(round),
            Stream.concat(after),
          );
        }),
      );

    const stream = (input: ChatInput): Stream.Stream<ChatEvent, ChatError> => {
      const base = Prompt.fromMessages(input.messages);
      const prompt = input.system === undefined ? base : Prompt.setSystem(base, input.system);
      return step(prompt, 0, input.maxSteps ?? DEFAULT_MAX_STEPS).pipe(
        Stream.withSpan("Chat.stream"),
      );
    };

    return Service.of({ stream });
  }),
);

export * as Chat from "./service.js";
