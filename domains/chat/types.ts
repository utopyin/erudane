import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";
import type * as Tool from "effect/unstable/ai/Tool";

export interface ChatInput {
  /** Full transcript, already decoded into Effect AI messages by the caller. */
  readonly messages: ReadonlyArray<Prompt.Message>;
  /** Optional system prompt; prepended when present. */
  readonly system?: string | undefined;
  /** Upper bound on model rounds per run. */
  readonly maxSteps?: number | undefined;
}

/**
 * Entrypoint-neutral event stream. Effect AI parts are re-emitted verbatim
 * inside a step; step markers give adapters a stable boundary per model round.
 */
export type ChatEvent = Data.TaggedEnum<{
  /** `messageId` is the id the step's assistant message is stored under (see `Run`). */
  StepStart: { readonly step: number; readonly messageId: MessageId };
  Part: { readonly step: number; readonly part: Response.StreamPart<any> };
  StepEnd: {
    readonly step: number;
    readonly reason: Response.FinishReason;
    readonly usage: Response.Usage;
  };
  MaxStepsReached: { readonly step: number };
}>;

export const ChatEvent = Data.taggedEnum<ChatEvent>();

type PlainSchema = Schema.Codec<any, any, never, never>;

/**
 * A tool the registry may contain: JSON-shaped schemas that need no services,
 * and no per-request requirements. Keeps the run's requirement channel closed
 * without the domain knowing the concrete registry, and lets the client derive
 * Standard Schemas from the same definition.
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

export const ThreadId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const MessageId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export class Thread extends Schema.Class<Thread>("Chat.Thread")({
  id: ThreadId,
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

/** A stored message: Effect AI's `Prompt.Message` plus identity and order. */
export class StoredMessage extends Schema.Class<StoredMessage>("Chat.StoredMessage")({
  id: MessageId,
  threadId: ThreadId,
  seq: Schema.Int,
  message: Prompt.Message,
  createdAt: Schema.DateTimeUtc,
}) {}

export interface NewMessage {
  readonly id: MessageId;
  readonly message: Prompt.Message;
}

export interface RunInput {
  readonly threadId: ThreadId;
  /** The one new message of this run; history comes from the repository. */
  readonly message: Prompt.UserMessage;
  readonly system?: string | undefined;
  readonly maxSteps?: number | undefined;
}
