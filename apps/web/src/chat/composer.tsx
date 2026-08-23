import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendIcon, StopIcon } from "@/components/icons";

interface ComposerProps {
  readonly busy: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

export function Composer({ busy, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message Erudane…"
        rows={1}
        className="max-h-40 min-h-10 flex-1 resize-none"
        aria-label="Message"
      />
      {busy ? (
        <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop">
          <StopIcon />
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={text.trim().length === 0} aria-label="Send">
          <SendIcon />
        </Button>
      )}
    </form>
  );
}
