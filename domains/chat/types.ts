import * as Data from "effect/Data";
import type * as Schema from "effect/Schema";
import type * as Prompt from "effect/unstable/ai/Prompt";
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
  StepStart: { readonly step: number };
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
