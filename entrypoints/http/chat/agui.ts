/**
 * AG-UI codec: the wire protocol spoken by TanStack AI's `useChat`.
 *
 * Inbound: `RunAgentInput` (flat wire messages) → `ChatInput`.
 * Outbound: `ChatEvent` → AG-UI events → SSE text.
 *
 * Everything TanStack/AG-UI specific lives here.
 */
import type { ChatError } from "@erudane/chat/errors";
import type { ChatEvent, ChatInput } from "@erudane/chat/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";
import * as Sse from "effect/unstable/encoding/Sse";

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

const TextContent = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

const WireContent = Schema.Union([Schema.String, Schema.Array(TextContent)]);

const ToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("function"),
  function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
});

const WireMessage = Schema.Union([
  Schema.Struct({ id: Schema.String, role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ id: Schema.String, role: Schema.Literal("user"), content: WireContent }),
  Schema.Struct({ id: Schema.String, role: Schema.Literal("reasoning"), content: Schema.String }),
  Schema.Struct({
    id: Schema.String,
    role: Schema.Literal("assistant"),
    content: Schema.optional(Schema.String),
    toolCalls: Schema.optional(Schema.Array(ToolCall)),
  }),
  Schema.Struct({
    id: Schema.String,
    role: Schema.Literal("tool"),
    toolCallId: Schema.String,
    content: Schema.String,
    error: Schema.optional(Schema.String),
  }),
]);

export type WireMessage = typeof WireMessage.Type;

export const RunAgentInput = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.String,
  messages: Schema.Array(WireMessage),
  tools: Schema.optional(Schema.Array(Schema.Unknown)),
  forwardedProps: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export type RunAgentInput = typeof RunAgentInput.Type;

export class UnsupportedInput extends Schema.TaggedError<UnsupportedInput>()(
  "Agui.UnsupportedInput",
  { message: Schema.String },
) {}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Wire messages → `ChatInput`. System messages become the prompt's system text. */
export const toChatInput = (
  input: RunAgentInput,
  options?: { readonly maxSteps?: number | undefined },
): Effect.Effect<ChatInput, UnsupportedInput> =>
  Effect.gen(function* () {
    const messages: Array<Prompt.Message> = [];
    const toolNames = new Map<string, string>();
    let system: string | undefined;
    let pendingResults: Array<Prompt.ToolResultPart> = [];

    const flushResults = () => {
      if (pendingResults.length > 0) {
        messages.push(Prompt.toolMessage({ content: pendingResults }));
        pendingResults = [];
      }
    };

    for (const message of input.messages) {
      if (message.role !== "tool") flushResults();
      switch (message.role) {
        case "system": {
          if (system !== undefined) {
            return yield* new UnsupportedInput({ message: "multiple system messages" });
          }
          system = message.content;
          break;
        }
        case "reasoning":
          break;
        case "user": {
          messages.push(
            Prompt.userMessage({
              content:
                typeof message.content === "string"
                  ? [Prompt.textPart({ text: message.content })]
                  : message.content.map((part) => Prompt.textPart({ text: part.text })),
            }),
          );
          break;
        }
        case "assistant": {
          const content: Array<Prompt.AssistantMessagePart> = [];
          if (message.content !== undefined && message.content.length > 0) {
            content.push(Prompt.textPart({ text: message.content }));
          }
          for (const call of message.toolCalls ?? []) {
            toolNames.set(call.id, call.function.name);
            content.push(
              Prompt.toolCallPart({
                id: call.id,
                name: call.function.name,
                params: parseJson(call.function.arguments),
                providerExecuted: false,
              }),
            );
          }
          if (content.length > 0) messages.push(Prompt.assistantMessage({ content }));
          break;
        }
        case "tool": {
          const name = toolNames.get(message.toolCallId);
          if (name === undefined) {
            return yield* new UnsupportedInput({
              message: `tool result ${message.toolCallId} without a preceding tool call`,
            });
          }
          pendingResults.push(
            Prompt.toolResultPart({
              id: message.toolCallId,
              name,
              result: parseJson(message.content),
              isFailure: message.error !== undefined,
              providerExecuted: false,
            }),
          );
          break;
        }
      }
    }
    flushResults();

    return { messages, system, maxSteps: options?.maxSteps };
  });

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface RunIds {
  readonly threadId: string;
  readonly runId: string;
}

type Json = Record<string, unknown>;

interface EncoderState {
  failure: Cause.Cause<ChatError> | undefined;
  readonly messageId: string;
  readonly startedToolCalls: Set<string>;
  readonly reasoningIds: Set<string>;
  reason: Response.FinishReason;
  inputTokens: number;
  outputTokens: number;
}

const finishReason = (reason: Response.FinishReason): string | null => {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content-filter":
      return "content_filter";
    case "tool-calls":
      return "tool_calls";
    default:
      return null;
  }
};

const partEvents = (state: EncoderState, part: Response.StreamPart<any>): ReadonlyArray<Json> => {
  const messageId = state.messageId;
  switch (part.type) {
    case "text-delta":
      return [{ type: "TEXT_MESSAGE_CONTENT", messageId, delta: part.delta }];
    case "reasoning-start": {
      state.reasoningIds.add(part.id);
      return [
        {
          type: "REASONING_MESSAGE_START",
          messageId: `${messageId}-r${part.id}`,
          role: "reasoning",
        },
      ];
    }
    case "reasoning-delta":
      return [
        {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: `${messageId}-r${part.id}`,
          delta: part.delta,
        },
      ];
    case "reasoning-end":
      return [{ type: "REASONING_MESSAGE_END", messageId: `${messageId}-r${part.id}` }];
    case "tool-params-start": {
      state.startedToolCalls.add(part.id);
      return [
        {
          type: "TOOL_CALL_START",
          toolCallId: part.id,
          toolCallName: part.name,
          parentMessageId: messageId,
        },
      ];
    }
    case "tool-params-delta":
      return [{ type: "TOOL_CALL_ARGS", toolCallId: part.id, delta: part.delta }];
    case "tool-call": {
      const events: Array<Json> = [];
      if (!state.startedToolCalls.has(part.id)) {
        state.startedToolCalls.add(part.id);
        events.push(
          {
            type: "TOOL_CALL_START",
            toolCallId: part.id,
            toolCallName: part.name,
            parentMessageId: messageId,
          },
          { type: "TOOL_CALL_ARGS", toolCallId: part.id, delta: JSON.stringify(part.params) },
        );
      }
      events.push({
        type: "TOOL_CALL_END",
        toolCallId: part.id,
        metadata: { tanstack: { input: part.params } },
      });
      return events;
    }
    case "tool-result": {
      if (part.preliminary) return [];
      return [
        {
          type: "TOOL_CALL_RESULT",
          messageId: `tool-${part.id}`,
          toolCallId: part.id,
          role: "tool",
          content: JSON.stringify(part.encodedResult),
          ...(part.isFailure ? { metadata: { tanstack: { state: "output-error" } } } : {}),
        },
      ];
    }
    case "finish": {
      state.inputTokens += part.usage.inputTokens.total ?? 0;
      state.outputTokens += part.usage.outputTokens.total ?? 0;
      return [];
    }
    default:
      return [];
  }
};

const errorMessage = (cause: Cause.Cause<ChatError>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? squashed.message : String(squashed);
};

const toSse = (event: Json): string =>
  Sse.encoder.write({
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(event),
  });

/** `ChatEvent` stream → SSE text (`data: {...}\n\n` per AG-UI event). */
export const encode =
  (ids: RunIds) =>
  <R>(events: Stream.Stream<ChatEvent, ChatError, R>): Stream.Stream<string, never, R> => {
    const initial = (): EncoderState => ({
      failure: undefined,
      messageId: `${ids.runId}-0`,
      startedToolCalls: new Set(),
      reasoningIds: new Set(),
      reason: "unknown",
      inputTokens: 0,
      outputTokens: 0,
    });

    const step = (
      state: EncoderState,
      event: Result.Result<ChatEvent, Cause.Cause<ChatError>>,
    ): readonly [EncoderState, ReadonlyArray<Json>] => {
      if (Result.isFailure(event)) {
        state.failure = event.failure;
        return [state, [runError(event.failure)]];
      }
      const chatEvent = event.success;
      switch (chatEvent._tag) {
        case "StepStart": {
          const next = { ...state, messageId: `${ids.runId}-${chatEvent.step}` };
          return [
            next,
            [{ type: "TEXT_MESSAGE_START", messageId: next.messageId, role: "assistant" }],
          ];
        }
        case "Part":
          return [state, partEvents(state, chatEvent.part)];
        case "StepEnd":
          state.reason = chatEvent.reason;
          return [state, [{ type: "TEXT_MESSAGE_END", messageId: state.messageId }]];
        case "MaxStepsReached":
          state.reason = "length";
          return [state, []];
      }
    };

    const runFinished = (state: EncoderState): Json => ({
      type: "RUN_FINISHED",
      threadId: ids.threadId,
      runId: ids.runId,
      usage: [
        {
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          totalTokens: state.inputTokens + state.outputTokens,
        },
      ],
      metadata: { tanstack: { finishReason: finishReason(state.reason) } },
    });

    const runError = (cause: Cause.Cause<ChatError>): Json => ({
      type: "RUN_ERROR",
      message: errorMessage(cause),
      metadata: { tanstack: { threadId: ids.threadId, runId: ids.runId } },
    });

    // Failures are folded into the accumulator so `onHalt` can tell a clean end
    // (RUN_FINISHED) from a failed one (RUN_ERROR already emitted).
    const body: Stream.Stream<Json, never, R> = events.pipe(
      Stream.map(Result.succeed),
      Stream.catchCause((cause) => Stream.succeed(Result.fail(cause))),
      Stream.mapAccum(initial, step, {
        onHalt: (state) => (state.failure === undefined ? [runFinished(state)] : []),
      }),
    );

    const started: Json = { type: "RUN_STARTED", threadId: ids.threadId, runId: ids.runId };
    return Stream.succeed(started).pipe(Stream.concat(body), Stream.map(toSse));
  };
