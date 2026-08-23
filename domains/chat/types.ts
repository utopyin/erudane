import * as Data from "effect/Data";
import type * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";

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
