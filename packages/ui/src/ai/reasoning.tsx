/**
 * A `thinking` part: collapsed by default, opens itself while the model is
 * still reasoning and closes shortly after, unless the user took over.
 */
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@erudane/ui/collapsible";
import { BrainIcon, ChevronDownIcon } from "@erudane/ui/icons";
import { Response } from "@erudane/ui/ai/response";
import { cn } from "@erudane/ui/utils";

const AUTO_CLOSE_MS = 1000;

interface ReasoningProps extends Omit<ComponentProps<typeof Collapsible>, "children"> {
  readonly content: string;
  readonly streaming?: boolean;
}

function Reasoning({ content, streaming = false, className, ...props }: ReasoningProps) {
  const [open, setOpen] = useState(streaming);
  const userToggled = useRef(false);
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (streaming) {
      startedAt.current ??= performance.now();
      if (!userToggled.current) setOpen(true);
      return;
    }
    if (startedAt.current !== null) {
      setSeconds(Math.max(1, Math.round((performance.now() - startedAt.current) / 1000)));
    }
    if (userToggled.current) return;
    const timer = setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [streaming]);

  return (
    <Collapsible
      data-slot="reasoning"
      open={open}
      onOpenChange={(next) => {
        userToggled.current = true;
        setOpen(next);
      }}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    >
      <CollapsibleTrigger className="hover:text-foreground flex items-center gap-2 transition-colors">
        <BrainIcon className={cn("size-4", streaming && "animate-pulse")} />
        <span>{streaming ? "Thinking…" : seconds ? `Thought for ${seconds}s` : "Thoughts"}</span>
        <ChevronDownIcon className="size-3.5 transition-transform group-data-open/collapsible:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <Response streaming={streaming} className="border-border mt-2 border-l-2 pl-4 text-sm">
          {content}
        </Response>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export { Reasoning };
