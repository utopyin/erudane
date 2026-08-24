/**
 * Stored messages → TanStack `UIMessage`s, for hydration (`GET /chat?threadId=`).
 * Shapes mirror what the client's own stream processor builds from our AG-UI
 * events, so a reload repaints exactly what was streamed: one assistant message
 * per step with thinking, text and tool-call parts; tool results folded into
 * their call and mirrored as `tool-result` parts.
 */
import type { StoredMessage } from "@erudane/chat/types";
import { Files } from "@erudane/files/service";
import { fromReference } from "@erudane/files/types";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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

const publicUrl = (value: string | URL): URL | undefined => {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

const userParts = (message: Prompt.UserMessage) =>
  Effect.gen(function* () {
    const files = yield* Files.Service;
    const parts: Array<Json> = [];
    for (const part of message.content) {
      if (part.type === "text") {
        parts.push({ type: "text", content: part.text });
        continue;
      }
      if (typeof part.data === "string" || part.data instanceof URL) {
        const id = fromReference(part.data);
        if (Option.isSome(id)) {
          const file = yield* files.get(id.value);
          parts.push({
            type: file.mediaType.startsWith("image/") ? "image" : "document",
            source: { type: "url", value: `/api/files/${file.id}` },
            metadata: { fileId: file.id, fileName: file.fileName, size: file.size },
          });
        } else {
          const url = publicUrl(part.data);
          if (
            url !== undefined &&
            (part.mediaType.startsWith("image/") || part.mediaType === "application/pdf")
          ) {
            parts.push({
              type: part.mediaType.startsWith("image/") ? "image" : "document",
              source: { type: "url", value: url.toString(), mimeType: part.mediaType },
              metadata: { fileName: part.fileName },
            });
          }
        }
      }
    }
    return parts;
  });

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

export const toUiMessages = (stored: ReadonlyArray<StoredMessage>) =>
  Effect.gen(function* () {
    const out: Array<UiMessage> = [];
    for (const item of stored) {
      const message = item.message;
      switch (message.role) {
        case "user":
          out.push({
            id: item.id,
            role: "user",
            parts: yield* userParts(message),
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
  });
