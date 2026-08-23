import * as Schema from "effect/Schema";
import { ThreadId } from "./types";
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

export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()("Chat.ThreadNotFound", {
  threadId: ThreadId,
}) {}

/** Storage failure at the repository seam; the cause is the driver's error. */
export class RepoError extends Schema.TaggedError<RepoError>()("Chat.RepoError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
