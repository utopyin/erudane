import { useChat } from "@tanstack/ai-react";
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

export function Chat() {
  const { messages, sendMessage, stop, status, error } = useChat(chatOptions);
  const empty = messages.length === 0;
  const last = messages.at(-1);

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
      <main className="flex h-dvh flex-col items-center justify-center gap-8 px-4">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          What do you have on your mind?
        </h1>
        <div className="w-full max-w-2xl">{composer}</div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-2xl px-4 py-8">
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                <MessageParts
                  message={message}
                  streaming={status === "streaming" && message === last}
                />
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">{composer}</div>
    </main>
  );
}
