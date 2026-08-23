import * as Effect from "effect/Effect";
import type { MessageId, ThreadId } from "./types";

// @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- one id, no service worth requiring for it
const uuid = Effect.sync(() => crypto.randomUUID());

export const messageId: Effect.Effect<MessageId> = uuid as Effect.Effect<MessageId>;
export const threadId: Effect.Effect<ThreadId> = uuid as Effect.Effect<ThreadId>;
