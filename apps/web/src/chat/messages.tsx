import type { UIMessage } from "@tanstack/ai-react";
import { cn } from "@/lib/utils";
import { MessagePart } from "./part";

export function Messages({ messages }: { messages: ReadonlyArray<UIMessage> }) {
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
    <li className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex flex-col gap-2",
          isUser
            ? "bg-muted max-w-[70%] rounded-3xl rounded-br-md px-4 py-2.5"
            : "w-full max-w-full",
        )}
      >
        {message.parts.map((part, index) => (
          <MessagePart key={index} part={part} />
        ))}
      </div>
    </li>
  );
}
