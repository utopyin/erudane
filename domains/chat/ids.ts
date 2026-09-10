import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { MessageId, ThreadId } from "./types";

/**
 * Id minting, resolved once when a layer is built: `const ids = yield* Ids.make`.
 * A failed random source is a defect, not something callers can handle.
 */
export const make = Crypto.Crypto.useSync((crypto) => {
  const uuid = Effect.orDie(crypto.randomUUIDv4);
  return {
    messageId: Effect.map(uuid, (id) => MessageId.make(id)),
    threadId: Effect.map(uuid, (id) => ThreadId.make(id)),
  };
});
