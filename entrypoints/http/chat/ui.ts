/**
 * Stored messages → TanStack `UIMessage`s, for hydration (`GET /chat?threadId=`).
 * Shapes mirror what the client's own stream processor builds from our AG-UI
 * events, so a reload repaints exactly what was streamed: one assistant message
 * per step with thinking, text and tool-call parts; tool results folded into
 * their call and mirrored as `tool-result` parts.
 */
import type { StoredMessage } from "@erudane/chat/types";
import * as DateTime from "effect/DateTime";
import type * as Prompt from "effect/unstable/ai/Prompt";

type Json = Record<string, unknown>;

interface UiMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: Array<Json>;
  readonly metadata: { readonly tanstack: { readonly createdAt: string } };
}

const metadata = (stored: StoredMessage) => ({
  tanstack: { createdAt: DateTime.formatIso(stored.createdAt) },
});

const userParts = (message: Prompt.UserMessage): Array<Json> =>
  message.content.flatMap((part) =>
    part.type === "text" ? [{ type: "text", content: part.text }] : [],
  );

const assistantParts = (message: Prompt.AssistantMessage): Array<Json> =>
  message.content.flatMap((part): Array<Json> => {
    switch (part.type) {
      case "text":
        return [{ type: "text", content: part.text }];
      case "reasoning":
        return [{ type: "thinking", content: part.text }];
      case "tool-call":
        return [
          {
            type: "tool-call",
            id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.params),
            input: part.params,
            state: "complete",
          },
        ];
      default:
        return [];
    }
  });

/** Folds a tool message's results into the preceding assistant message's tool-call parts. */
const applyResults = (target: UiMessage, message: Prompt.ToolMessage): void => {
  for (const result of message.content) {
    if (result.type !== "tool-result") continue;
    const content = JSON.stringify(result.result);
    const state = result.isFailure ? "error" : "complete";
    const call = target.parts.find(
      (part) => part["type"] === "tool-call" && part["id"] === result.id,
    );
    if (call) {
      call["output"] = result.result;
      if (result.isFailure) call["state"] = "error";
    }
    target.parts.push({ type: "tool-result", toolCallId: result.id, content, state });
  }
};

export const toUiMessages = (stored: ReadonlyArray<StoredMessage>): ReadonlyArray<UiMessage> => {
  const out: Array<UiMessage> = [];
  for (const item of stored) {
    const message = item.message;
    switch (message.role) {
      case "user":
        out.push({
          id: item.id,
          role: "user",
          parts: userParts(message),
          metadata: metadata(item),
        });
        break;
      case "assistant":
        out.push({
          id: item.id,
          role: "assistant",
          parts: assistantParts(message),
          metadata: metadata(item),
        });
        break;
      case "tool": {
        for (let index = out.length - 1; index >= 0; index -= 1) {
          const candidate = out[index];
          if (candidate?.role === "assistant") {
            applyResults(candidate, message);
            break;
          }
        }
        break;
      }
      case "system":
        break;
    }
  }
  return out;
};
