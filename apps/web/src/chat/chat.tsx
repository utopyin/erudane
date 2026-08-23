import { useChat } from "@tanstack/ai-react";
import { WarningIcon } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { chatOptions } from "./client";
import { Composer } from "./composer";
import { Messages } from "./messages";

export function Chat() {
  const { messages, sendMessage, stop, isLoading, error } = useChat(chatOptions);

  return (
    <div className="flex h-dvh flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <Messages messages={messages} />
        </div>
      </ScrollArea>
      <div className="bg-background/80 border-t backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-3">
          {error && (
            <p className="text-destructive flex items-center gap-2 text-sm" role="alert">
              <WarningIcon />
              {error.message}
            </p>
          )}
          <Composer busy={isLoading} onSend={(text) => void sendMessage(text)} onStop={stop} />
        </div>
      </div>
    </div>
  );
}
