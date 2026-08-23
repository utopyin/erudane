import type { UIMessage } from "@tanstack/ai-react";
import { Badge } from "@/components/ui/badge";
import { CircleCheckIcon, LoaderIcon, ToolIcon, WarningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Part = UIMessage["parts"][number];

export function MessagePart({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <p className="whitespace-pre-wrap leading-relaxed">{part.content}</p>;
    case "thinking":
      return (
        <details className="text-muted-foreground text-sm">
          <summary className="cursor-pointer select-none">Thinking</summary>
          <p className="mt-1 whitespace-pre-wrap">{part.content}</p>
        </details>
      );
    case "tool-call":
      return <ToolCall part={part} />;
    default:
      return null;
  }
}

function ToolCall({ part }: { part: Extract<Part, { type: "tool-call" }> }) {
  const running = part.state !== "complete" && part.state !== "error";
  const failed = part.state === "error";
  return (
    <div className="bg-muted/50 flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <ToolIcon className="text-muted-foreground" />
        <span className="font-medium">{part.name}</span>
        <Badge variant={failed ? "destructive" : "secondary"} className="ml-auto gap-1">
          {running ? (
            <LoaderIcon className="animate-spin" />
          ) : failed ? (
            <WarningIcon />
          ) : (
            <CircleCheckIcon />
          )}
          {part.state}
        </Badge>
      </div>
      {part.input !== undefined && Object.keys(part.input as object).length > 0 && (
        <Json label="input" value={part.input} />
      )}
      {part.output !== undefined && <Json label="output" value={part.output} />}
    </div>
  );
}

function Json({ label, value, className }: { label: string; value: unknown; className?: string }) {
  return (
    <pre className={cn("text-muted-foreground overflow-x-auto font-mono text-xs", className)}>
      <span className="text-foreground/60">{label}: </span>
      {JSON.stringify(value)}
    </pre>
  );
}
