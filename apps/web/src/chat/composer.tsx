import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { SendIcon, StopIcon } from "@/components/icons";

interface ComposerProps {
  readonly busy: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly autoFocus?: boolean;
}

export function Composer({ busy, onSend, onStop, autoFocus }: ComposerProps) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !busy;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-card text-card-foreground flex flex-col gap-2 rounded-3xl border p-3 shadow-xs transition-shadow focus-within:shadow-sm"
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message Erudane…"
        rows={1}
        autoFocus={autoFocus}
        aria-label="Message"
        className="placeholder:text-muted-foreground field-sizing-content max-h-48 min-h-8 w-full resize-none bg-transparent px-1 py-1 text-base outline-none"
      />
      <div className="flex items-center justify-end">
        {busy ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="rounded-full"
            onClick={onStop}
            aria-label="Stop"
          >
            <StopIcon />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            className="rounded-full"
            disabled={!canSend}
            aria-label="Send"
          >
            <SendIcon />
          </Button>
        )}
      </div>
    </form>
  );
}
