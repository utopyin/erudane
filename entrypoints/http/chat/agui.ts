/**
 * AG-UI codec: the wire protocol spoken by TanStack AI's `useChat`.
 *
 * Inbound: `RunAgentInput` (flat wire messages) → the run's new user message.
 * Outbound: `ChatEvent` → AG-UI events → SSE text.
 *
 * Everything TanStack/AG-UI specific lives here.
 */
import type { ChatEvent } from "@erudane/chat/types";
import { Files } from "@erudane/files/service";
import { FileId, reference } from "@erudane/files/types";
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

const FileMetadata = Schema.Struct({
  fileId: FileId,
  fileName: Schema.optional(Schema.String),
  size: Schema.Int,
});

const Source = Schema.Struct({ type: Schema.Literal("url"), value: Schema.String });

const MediaContent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("image"),
    source: Source,
    metadata: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal("document"),
    source: Source,
    metadata: Schema.optional(Schema.Unknown),
  }),
]);

const WireContent = Schema.Union([
  Schema.String,
  Schema.Array(Schema.Union([TextContent, MediaContent])),
]);

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

/**
 * The run's new message: the last wire message, which must be from the user.
 * Everything before it is the client's copy of history; the server's is authoritative.
 */
export const toUserMessage = (input: RunAgentInput) =>
  Effect.gen(function* () {
    const last = input.messages[input.messages.length - 1];
    if (last === undefined || last.role !== "user") {
      return yield* new UnsupportedInput({ message: "the last message must be a user message" });
    }

    if (typeof last.content === "string") {
      if (last.content.trim().length === 0) {
        return yield* new UnsupportedInput({ message: "the user message is empty" });
      }
      return Prompt.userMessage({ content: [Prompt.textPart({ text: last.content })] });
    }

    const files = yield* Files.Service;
    const content: Array<Prompt.TextPart | Prompt.FilePart> = [];
    for (const part of last.content) {
      if (part.type === "text") {
        if (part.text.length > 0) content.push(Prompt.textPart({ text: part.text }));
        continue;
      }

      const metadata = yield* Schema.decodeUnknownEffect(FileMetadata)(part.metadata).pipe(
        Effect.mapError(
          () => new UnsupportedInput({ message: "file attachments require uploaded metadata" }),
        ),
      );
      const file = yield* files
        .get(metadata.fileId)
        .pipe(
          Effect.catchTag("Files.FileNotFound", () =>
            Effect.fail(new UnsupportedInput({ message: `unknown file ${metadata.fileId}` })),
          ),
        );
      const expectedType = file.mediaType.startsWith("image/") ? "image" : "document";
      const expectedSource = `/api/files/${file.id}`;
      if (
        part.type !== expectedType ||
        part.source.value !== expectedSource ||
        metadata.size !== file.size ||
        metadata.fileName !== file.fileName
      ) {
        return yield* new UnsupportedInput({ message: `invalid metadata for file ${file.id}` });
      }
      content.push(
        Prompt.filePart({
          mediaType: file.mediaType,
          fileName: file.fileName,
          data: reference(file.id),
        }),
      );
    }

    if (content.length === 0) {
      return yield* new UnsupportedInput({ message: "the user message is empty" });
    }
    return Prompt.userMessage({ content });
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
  failure: Cause.Cause<unknown> | undefined;
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

const errorMessage = (cause: Cause.Cause<unknown>): string => {
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
  <E, R>(events: Stream.Stream<ChatEvent, E, R>): Stream.Stream<string, never, R> => {
    const initial = (): EncoderState => ({
      failure: undefined,
      messageId: ids.runId,
      startedToolCalls: new Set(),
      reasoningIds: new Set(),
      reason: "unknown",
      inputTokens: 0,
      outputTokens: 0,
    });

    const step = (
      state: EncoderState,
      event: Result.Result<ChatEvent, Cause.Cause<E>>,
    ): readonly [EncoderState, ReadonlyArray<Json>] => {
      if (Result.isFailure(event)) {
        state.failure = event.failure;
        return [state, [runError(event.failure)]];
      }
      const chatEvent = event.success;
      switch (chatEvent._tag) {
        case "StepStart": {
          // The stored assistant message id, so hydration repaints the same bubble.
          const next = { ...state, messageId: chatEvent.messageId };
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

    const runError = (cause: Cause.Cause<E>): Json => ({
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
