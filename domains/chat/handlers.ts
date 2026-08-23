import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { ChatTools } from "./tools.js";

/** Handler layer for the chat domain's own tools. */
export const layer = ChatTools.toolkit.toLayer(
  ChatTools.toolkit.of({
    CurrentTime: () => Effect.map(DateTime.now, (now) => ({ iso: DateTime.formatIso(now) })),
  }),
);

export * as ChatHandlers from "./handlers.js";
