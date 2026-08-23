import * as Schema from "effect/Schema";
import type * as AiError from "effect/unstable/ai/AiError";

/** Failure of a chat run, mapped from the provider's `AiError` at the service seam. */
export class ChatError extends Schema.TaggedError<ChatError>()("Chat.Error", {
  step: Schema.Finite,
  reason: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
}) {
  static fromAiError(step: number, error: AiError.AiError): ChatError {
    return new ChatError({
      step,
      reason: error.reason._tag,
      message: error.message,
      retryable: error.isRetryable,
    });
  }
}
