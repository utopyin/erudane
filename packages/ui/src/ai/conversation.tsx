/**
 * Scrolling message column that follows the stream while the user is at the
 * bottom, releases when they scroll up, and offers a "jump to latest" button.
 */
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";

import { Button } from "@erudane/ui/button";
import { ArrowDownIcon } from "@erudane/ui/icons";
import { ScrollBar } from "@erudane/ui/scroll-area";
import { cn } from "@erudane/ui/utils";

const PIN_THRESHOLD_PX = 32;

interface ConversationState {
  readonly pinned: boolean;
  readonly scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const Context = createContext<ConversationState>({ pinned: true, scrollToBottom: () => {} });

function useStickToBottom(viewport: RefObject<HTMLDivElement | null>) {
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = viewport.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      pinnedRef.current = true;
      setPinned(true);
    },
    [viewport],
  );

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const next = distance <= PIN_THRESHOLD_PX;
      if (next !== pinnedRef.current) {
        pinnedRef.current = next;
        setPinned(next);
      }
    };

    // Content grows while streaming: follow it only when pinned.
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [viewport]);

  return { pinned, scrollToBottom };
}

function Conversation({ className, children, ...props }: ScrollAreaPrimitive.Root.Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const state = useStickToBottom(viewport);
  return (
    <Context.Provider value={state}>
      <ScrollAreaPrimitive.Root
        data-slot="conversation"
        className={cn("relative min-h-0 flex-1", className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewport}
          data-slot="conversation-viewport"
          className="size-full outline-none"
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </Context.Provider>
  );
}

function ConversationContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="conversation-content"
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  );
}

function ConversationScrollButton({ className, ...props }: ComponentProps<typeof Button>) {
  const { pinned, scrollToBottom } = useContext(Context);
  if (pinned) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label="Scroll to latest"
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md",
        className,
      )}
      onClick={() => scrollToBottom()}
      {...props}
    >
      <ArrowDownIcon />
    </Button>
  );
}

export { Conversation, ConversationContent, ConversationScrollButton };
