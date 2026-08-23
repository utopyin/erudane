import type { ContentPart } from "@tanstack/ai";
import { useChat } from "@tanstack/ai-react";
import { useRouter } from "@tanstack/react-router";
import { MAX_BYTES, MEDIA_TYPES } from "@erudane/files/types";
import { Fragment } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@erudane/ui/ai/conversation";
import { Message, MessageContent, MessageParts } from "@erudane/ui/ai/message";
import {
  PromptInput,
  PromptInputAttachmentButton,
  PromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  type UploadedAttachment,
} from "@erudane/ui/ai/prompt";
import { WarningIcon } from "@erudane/ui/icons";
import * as Schema from "effect/Schema";
import { chatOptions } from "./client";
import { Sources, collectSources, renderers } from "./research";

const UploadResponse = Schema.Struct({
  id: Schema.String,
  mediaType: Schema.String,
  fileName: Schema.optional(Schema.String),
  size: Schema.Int,
});

const upload = async (file: File, signal: AbortSignal): Promise<UploadedAttachment> => {
  const response = await fetch("/api/files", {
    method: "POST",
    headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) },
    body: file,
    signal,
  });
  if (!response.ok) throw new Error((await response.text()) || "Upload failed");
  return Schema.decodeUnknownSync(UploadResponse)(await response.json());
};

export function Chat({ threadId }: { readonly threadId: string }) {
  const router = useRouter();
  const { messages, sendMessage, stop, status, error } = useChat({
    ...chatOptions,
    persistence: true,
    threadId,
    // The first run of a new thread creates it server-side; refresh the sidebar.
    onFinish: () => void router.invalidate(),
  });
  const empty = messages.length === 0;
  const last = messages.at(-1);
  const runs = groupRuns(messages);

  const composer = (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="text-destructive flex items-center gap-2 px-2 text-sm" role="alert">
          <WarningIcon />
          {error.message}
        </p>
      )}
      <PromptInput
        status={status}
        acceptedMediaTypes={MEDIA_TYPES}
        maxFileBytes={MAX_BYTES}
        onUpload={upload}
        onSubmit={({ text, attachments }) => {
          const content: Array<ContentPart> = [];
          if (text.length > 0) content.push({ type: "text", content: text });
          for (const attachment of attachments) {
            content.push({
              type: attachment.mediaType.startsWith("image/") ? "image" : "document",
              source: { type: "url", value: `/api/files/${attachment.id}` },
              metadata: {
                fileId: attachment.id,
                fileName: attachment.fileName,
                size: attachment.size,
              },
            });
          }
          void sendMessage({ content });
        }}
        onStop={stop}
      >
        <PromptInputAttachments />
        <PromptInputTextarea placeholder="Message Erudane…" autoFocus />
        <PromptInputToolbar>
          <PromptInputAttachmentButton />
          <PromptInputSubmit />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );

  return (
    <main className="relative flex h-full flex-col">
      {empty ? (
        <div className="flex flex-1 items-center justify-center px-4 pb-36">
          <h1 className="font-heading text-3xl font-medium tracking-tight">
            What do you have on your mind?
          </h1>
        </div>
      ) : (
        <Conversation>
          <ConversationContent className="mx-auto w-full max-w-2xl px-4 py-8">
            {runs.map((run) => (
              <Fragment key={run[0]?.id}>
                {run.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      <MessageParts
                        message={message}
                        streaming={status === "streaming" && message === last}
                        renderers={renderers}
                      />
                    </MessageContent>
                  </Message>
                ))}
                {(status !== "streaming" || !run.includes(last!)) && (
                  <Sources sources={collectSources(run)} />
                )}
              </Fragment>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
      <div
        className={
          empty
            ? "absolute top-1/2 left-1/2 mt-8 w-full max-w-2xl -translate-x-1/2 px-4"
            : "mx-auto w-full max-w-2xl px-4 pb-4"
        }
      >
        {composer}
      </div>
    </main>
  );
}

type UiMessage = ReturnType<typeof useChat>["messages"][number];

/** A run is a user message followed by the assistant messages (one per step) it produced. */
const groupRuns = (messages: ReadonlyArray<UiMessage>): ReadonlyArray<ReadonlyArray<UiMessage>> => {
  const runs: Array<Array<UiMessage>> = [];
  for (const message of messages) {
    const current = runs.at(-1);
    if (message.role === "user" || current === undefined) runs.push([message]);
    else current.push(message);
  }
  return runs;
};
