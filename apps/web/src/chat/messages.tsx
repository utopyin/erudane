import type { UIMessage } from "@tanstack/ai-react";
import { SparkleIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MessagePart } from "./part";

export function Messages({ messages }: { messages: ReadonlyArray<UIMessage> }) {
  if (messages.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Ask anything to get started.
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-6">
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
    </ol>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <li className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {isUser ? <UserIcon /> : <SparkleIcon />}
      </span>
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-2",
          isUser && "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2",
        )}
      >
        {message.parts.map((part, index) => (
          <MessagePart key={index} part={part} />
        ))}
      </div>
    </li>
  );
}
