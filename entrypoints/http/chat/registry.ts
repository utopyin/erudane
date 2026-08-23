import { ChatHandlers } from "@erudane/chat/handlers";
import { Chat } from "@erudane/chat/service";
import * as Layer from "effect/Layer";
import { Registry } from "./tools";

/** `Chat.Toolkit` backed by the merged registry and every domain's handler layer. */
export const layer = Layer.effect(Chat.Toolkit, Registry.toolkit).pipe(
  Layer.provide(ChatHandlers.layer),
);
