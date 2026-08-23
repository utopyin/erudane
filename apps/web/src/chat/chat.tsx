import { useChat } from "@tanstack/ai-react";
import { WarningIcon } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { chatOptions } from "./client";
import { Composer } from "./composer";
import { Messages } from "./messages";

export function Chat() {
  const { messages, sendMessage, stop, isLoading, error } = useChat(chatOptions);
  const empty = messages.length === 0;

  const composer = (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="text-destructive flex items-center gap-2 px-2 text-sm" role="alert">
          <WarningIcon />
          {error.message}
        </p>
      )}
      <Composer
        busy={isLoading}
        onSend={(text) => void sendMessage(text)}
        onStop={stop}
        autoFocus
      />
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <Messages messages={messages} />
        </div>
      </ScrollArea>
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">{composer}</div>
    </main>
  );
}
