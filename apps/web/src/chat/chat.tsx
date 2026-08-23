import { useChat } from "@tanstack/ai-react";
import { useRouter } from "@tanstack/react-router";
import { Fragment } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@erudane/ui/ai/conversation";
import { Message, MessageContent, MessageParts } from "@erudane/ui/ai/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@erudane/ui/ai/prompt";
import { WarningIcon } from "@erudane/ui/icons";
import { chatOptions } from "./client";
import { Sources, collectSources, renderers } from "./research";

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
      <PromptInput status={status} onSubmit={(text) => void sendMessage(text)} onStop={stop}>
        <PromptInputTextarea placeholder="Message Erudane…" autoFocus />
        <PromptInputToolbar>
          <PromptInputSubmit />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );

  if (empty) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-8 px-4">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          What do you have on your mind?
        </h1>
        <div className="w-full max-w-2xl">{composer}</div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
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
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">{composer}</div>
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
