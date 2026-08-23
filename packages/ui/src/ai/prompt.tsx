/**
 * The composer. `status` is TanStack's `ChatClientState`, so `useChat().status`
 * plugs in directly; the submit button derives send / stop from it.
 */
import type { ChatClientState } from "@tanstack/ai-client";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { Button } from "@erudane/ui/button";
import { LoaderIcon, SendIcon, StopIcon } from "@erudane/ui/icons";
import { cn } from "@erudane/ui/utils";

interface PromptState {
  readonly status: ChatClientState;
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly submit: () => void;
  readonly stop: () => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const Context = createContext<PromptState | null>(null);

function usePrompt(): PromptState {
  const state = useContext(Context);
  if (!state) throw new Error("PromptInput.* must be rendered inside <PromptInput>");
  return state;
}

const isBusy = (status: ChatClientState) => status === "submitted" || status === "streaming";

interface PromptInputProps extends Omit<ComponentProps<"form">, "onSubmit"> {
  readonly status: ChatClientState;
  readonly onSubmit: (text: string) => void;
  readonly onStop?: () => void;
}

function PromptInput({ status, onSubmit, onStop, className, onClick, ...props }: PromptInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isBusy(status)) return;
    onSubmit(trimmed);
    setText("");
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  // Clicking the card's padding or toolbar gap focuses the textarea, so the
  // whole box behaves as the input. Clicks on controls keep their own focus.
  const onCardClick = (event: MouseEvent<HTMLFormElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [tabindex]")) return;
    textareaRef.current?.focus();
  };

  return (
    <Context.Provider
      value={{ status, text, setText, submit, stop: onStop ?? (() => {}), textareaRef }}
    >
      <form
        data-slot="prompt-input"
        onSubmit={onFormSubmit}
        onClick={onCardClick}
        className={cn(
          "bg-card text-card-foreground flex cursor-text flex-col gap-2 rounded-3xl border p-3",
          className,
        )}
        {...props}
      />
    </Context.Provider>
  );
}

function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange">) {
  const { text, setText, submit, textareaRef } = usePrompt();

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      data-slot="prompt-input-textarea"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={handleKeyDown}
      rows={1}
      aria-label="Message"
      className={cn(
        "placeholder:text-muted-foreground field-sizing-content max-h-48 min-h-8 w-full resize-none bg-transparent px-1 py-1 text-base outline-none",
        className,
      )}
      {...props}
    />
  );
}

function PromptInputToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-toolbar"
      className={cn("flex items-center justify-end gap-1", className)}
      {...props}
    />
  );
}

function PromptInputSubmit({ className, ...props }: ComponentProps<typeof Button>) {
  const { status, text, stop } = usePrompt();
  const busy = isBusy(status);

  if (busy) {
    return (
      <Button
        type="button"
        size="icon-sm"
        aria-label="Stop"
        className={cn("rounded-full", className)}
        onClick={stop}
        {...props}
      >
        {status === "submitted" ? <LoaderIcon className="animate-spin" /> : <StopIcon />}
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      size="icon-sm"
      aria-label="Send"
      disabled={text.trim().length === 0}
      className={cn("rounded-full", className)}
      {...props}
    >
      <SendIcon />
    </Button>
  );
}

export { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputSubmit };
