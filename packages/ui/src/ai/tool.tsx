/**
 * A `tool-call` part. The part carries the whole lifecycle — streaming
 * arguments, parsed `input`, then `output`/`error` written back by the
 * client on `TOOL_CALL_RESULT` — so nothing else is needed to render it.
 */
import type { ToolCallPart } from "@tanstack/ai-client";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

import { Badge } from "@erudane/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@erudane/ui/collapsible";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  LoaderIcon,
  ToolIcon,
  WarningIcon,
} from "@erudane/ui/icons";
import { cn } from "@erudane/ui/utils";

type Part = ToolCallPart;
type State = Part["state"];

const Context = createContext<Part | null>(null);

function usePart(): Part {
  const part = useContext(Context);
  if (!part) throw new Error("Tool.* must be rendered inside <Tool>");
  return part;
}

const isSettled = (state: State) => state === "complete" || state === "error";
const isAttention = (state: State) => state === "error" || state === "approval-requested";

const labels: Record<State, string> = {
  "awaiting-input": "Pending",
  "input-streaming": "Preparing",
  "input-complete": "Running",
  "approval-requested": "Needs approval",
  "approval-responded": "Running",
  complete: "Done",
  error: "Failed",
};

interface ToolProps extends Omit<ComponentProps<typeof Collapsible>, "children" | "part"> {
  readonly part: Part;
  readonly children?: ReactNode;
}

function Tool({ part, className, children, ...props }: ToolProps) {
  return (
    <Context.Provider value={part}>
      <Collapsible
        data-slot="tool"
        data-state={part.state}
        defaultOpen={isAttention(part.state)}
        className={cn("bg-muted/50 rounded-2xl border text-sm", className)}
        {...props}
      >
        {children ?? (
          <>
            <ToolHeader />
            <ToolContent>
              <ToolInput />
              <ToolOutput />
            </ToolContent>
          </>
        )}
      </Collapsible>
    </Context.Provider>
  );
}

function ToolHeader({ className, ...props }: ComponentProps<typeof CollapsibleTrigger>) {
  const part = usePart();
  const failed = part.state === "error";
  return (
    <CollapsibleTrigger
      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left", className)}
      {...props}
    >
      <ToolIcon className="text-muted-foreground size-4" />
      <span className="font-medium">{part.name}</span>
      <Badge variant={failed ? "destructive" : "secondary"} className="ml-auto gap-1">
        {isSettled(part.state) ? (
          failed ? (
            <WarningIcon />
          ) : (
            <CircleCheckIcon />
          )
        ) : (
          <LoaderIcon className="animate-spin" />
        )}
        {labels[part.state]}
      </Badge>
      <ChevronDownIcon className="text-muted-foreground size-3.5 transition-transform group-data-open/collapsible:rotate-180" />
    </CollapsibleTrigger>
  );
}

function ToolContent({ className, ...props }: ComponentProps<typeof CollapsiblePanel>) {
  return <CollapsiblePanel className={cn("flex flex-col gap-2 px-3 pb-3", className)} {...props} />;
}

function ToolInput({ className, ...props }: ComponentProps<"div">) {
  const part = usePart();
  const value = part.input ?? (part.arguments.length > 0 ? part.arguments : undefined);
  if (value === undefined) return null;
  return (
    <div data-slot="tool-input" className={className} {...props}>
      <Label>Input</Label>
      <Json value={value} />
    </div>
  );
}

function ToolOutput({ className, ...props }: ComponentProps<"div">) {
  const part = usePart();
  if (part.output === undefined) return null;
  const failed = part.state === "error";
  return (
    <div data-slot="tool-output" className={className} {...props}>
      <Label>{failed ? "Error" : "Output"}</Label>
      <Json value={part.output} className={cn(failed && "text-destructive")} />
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">{children}</div>;
}

function Json({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className={cn(
        "bg-background overflow-x-auto rounded-xl border px-3 py-2 font-mono text-xs",
        className,
      )}
    >
      {text}
    </pre>
  );
}

export { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput };
