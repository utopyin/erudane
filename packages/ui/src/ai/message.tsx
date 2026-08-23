/**
 * One turn of a conversation. `MessageParts` is the single place that
 * switches on `part.type`; apps override individual renderers (e.g. a
 * custom card for one tool) without touching the switch.
 */
import type { UIMessage } from "@tanstack/ai-client";
import { Fragment, createContext, useContext, type ComponentProps, type ReactNode } from "react";

import { Reasoning } from "@erudane/ui/ai/reasoning";
import { Response } from "@erudane/ui/ai/response";
import { Tool } from "@erudane/ui/ai/tool";
import { cn } from "@erudane/ui/utils";

type Role = UIMessage["role"];
type Part = UIMessage["parts"][number];
type PartOf<T extends Part["type"]> = Extract<Part, { type: T }>;

interface PartContext {
  readonly message: UIMessage;
  readonly role: Role;
  readonly index: number;
  /** True for the part currently being appended to by the stream. */
  readonly streaming: boolean;
}

/** Return `undefined` to fall back to the default renderer for that type. */
type PartRenderers = {
  readonly [T in Part["type"]]?: (part: PartOf<T>, ctx: PartContext) => ReactNode | undefined;
};

const RoleContext = createContext<Role>("assistant");

function Message({ from, className, ...props }: ComponentProps<"div"> & { from: Role }) {
  return (
    <RoleContext.Provider value={from}>
      <div
        data-slot="message"
        data-role={from}
        className={cn("flex", from === "user" ? "justify-end" : "justify-start", className)}
        {...props}
      />
    </RoleContext.Provider>
  );
}

function MessageContent({ className, ...props }: ComponentProps<"div">) {
  const role = useContext(RoleContext);
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex flex-col gap-3",
        role === "user"
          ? "bg-muted max-w-[70%] rounded-3xl rounded-br-md px-4 py-2.5"
          : "w-full max-w-full",
        className,
      )}
      {...props}
    />
  );
}

const defaults: PartRenderers = {
  // User text is shown verbatim; only the model's text is markdown.
  text: (part, { role, streaming }) =>
    role === "user" ? (
      <p className="whitespace-pre-wrap">{part.content}</p>
    ) : (
      <Response streaming={streaming}>{part.content}</Response>
    ),
  thinking: (part, { streaming }) => <Reasoning content={part.content} streaming={streaming} />,
  "tool-call": (part) => <Tool part={part} />,
};

interface MessagePartsProps {
  readonly message: UIMessage;
  /** Whether this message is the one the stream is writing to. */
  readonly streaming?: boolean;
  readonly renderers?: PartRenderers;
}

function MessageParts({ message, streaming = false, renderers }: MessagePartsProps) {
  const role = useContext(RoleContext);
  const last = message.parts.length - 1;
  return (
    <>
      {message.parts.map((part, index) => {
        const ctx: PartContext = { message, role, index, streaming: streaming && index === last };
        const node = render(renderers, part, ctx) ?? render(defaults, part, ctx);
        if (node === undefined || node === null) return null;
        return <Fragment key={partKey(part, index)}>{node}</Fragment>;
      })}
    </>
  );
}

type AnyRenderer = (part: Part, ctx: PartContext) => ReactNode | undefined;

const render = (renderers: PartRenderers | undefined, part: Part, ctx: PartContext) =>
  (renderers?.[part.type] as AnyRenderer | undefined)?.(part, ctx);

const partKey = (part: Part, index: number) =>
  part.type === "tool-call" ? `tool-call:${part.id}` : `${part.type}:${index}`;

export { Message, MessageContent, MessageParts };
export type { PartRenderers, PartContext };
