import type { ChatClientState } from "@tanstack/ai-client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { Attachment } from "@erudane/ui/ai/attachment";
import { Button } from "@erudane/ui/button";
import { LoaderIcon, PaperclipIcon, SendIcon, StopIcon } from "@erudane/ui/icons";
import { ScrollArea } from "@erudane/ui/scroll-area";
import { Textarea } from "@erudane/ui/textarea";
import { cn } from "@erudane/ui/utils";

export interface UploadedAttachment {
  readonly id: string;
  readonly mediaType: string;
  readonly fileName?: string | undefined;
  readonly size: number;
}

export interface PromptSubmit {
  readonly text: string;
  readonly attachments: ReadonlyArray<UploadedAttachment>;
}

interface DraftAttachment {
  readonly clientId: string;
  readonly file: File;
  readonly previewUrl?: string | undefined;
  readonly status: "uploading" | "ready" | "error";
  readonly uploaded?: UploadedAttachment | undefined;
  readonly error?: string | undefined;
}

interface PromptState {
  readonly status: ChatClientState;
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly attachments: ReadonlyArray<DraftAttachment>;
  readonly acceptedMediaTypes: ReadonlyArray<string>;
  readonly addFiles: (files: Iterable<File>) => void;
  readonly removeFile: (clientId: string) => void;
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

const clientError = (
  file: File,
  maxFileBytes: number,
  acceptedMediaTypes: ReadonlyArray<string>,
): string | undefined => {
  if (!acceptedMediaTypes.includes(file.type)) {
    return "Images and PDFs only";
  }
  if (file.size === 0) return "File is empty";
  if (file.size > maxFileBytes) {
    return `File exceeds ${Math.round(maxFileBytes / 1024 / 1024)} MB`;
  }
  return undefined;
};

interface PromptInputProps extends Omit<ComponentProps<"form">, "onSubmit"> {
  readonly status: ChatClientState;
  readonly onSubmit: (input: PromptSubmit) => void;
  readonly onUpload: (file: File, signal: AbortSignal) => Promise<UploadedAttachment>;
  readonly acceptedMediaTypes: ReadonlyArray<string>;
  readonly maxFileBytes: number;
  readonly onStop?: () => void;
}

function PromptInput({
  status,
  onSubmit,
  onUpload,
  acceptedMediaTypes,
  maxFileBytes,
  onStop,
  className,
  onClick,
  onDrop,
  onDragOver,
  ...props
}: PromptInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<DraftAttachment>>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const previews = useRef(new Map<string, string>());
  const nextAttachmentId = useRef(0);

  const dispose = (attachment: DraftAttachment) => {
    controllers.current.get(attachment.clientId)?.abort();
    controllers.current.delete(attachment.clientId);
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    previews.current.delete(attachment.clientId);
  };

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
      for (const preview of previews.current.values()) URL.revokeObjectURL(preview);
      previews.current.clear();
    },
    [],
  );

  const addFiles = (incoming: Iterable<File>) => {
    for (const file of incoming) {
      const clientId = `attachment-${nextAttachmentId.current++}`;
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previews.current.set(clientId, previewUrl);
      const error = clientError(file, maxFileBytes, acceptedMediaTypes);
      const draft: DraftAttachment = {
        clientId,
        file,
        previewUrl,
        status: error ? "error" : "uploading",
        error,
      };
      setAttachments((current) => [...current, draft]);
      if (error) continue;

      const controller = new AbortController();
      controllers.current.set(clientId, controller);
      void onUpload(file, controller.signal)
        .then((uploaded) => {
          controllers.current.delete(clientId);
          if (controller.signal.aborted) return;
          setAttachments((current) =>
            current.map((item) =>
              item.clientId === clientId ? { ...item, status: "ready", uploaded } : item,
            ),
          );
        })
        .catch((cause: unknown) => {
          controllers.current.delete(clientId);
          if (controller.signal.aborted) return;
          const message = cause instanceof Error ? cause.message : "Upload failed";
          setAttachments((current) =>
            current.map((item) =>
              item.clientId === clientId ? { ...item, status: "error", error: message } : item,
            ),
          );
        });
    }
  };

  const removeFile = (clientId: string) => {
    setAttachments((current) => {
      const removed = current.find((item) => item.clientId === clientId);
      if (removed) dispose(removed);
      return current.filter((item) => item.clientId !== clientId);
    });
  };

  const submit = () => {
    const trimmed = text.trim();
    const blocked = attachments.some((attachment) => attachment.status !== "ready");
    const uploaded = attachments.flatMap((attachment) =>
      attachment.uploaded ? [attachment.uploaded] : [],
    );
    if (isBusy(status) || blocked || (trimmed.length === 0 && uploaded.length === 0)) return;
    onSubmit({ text: trimmed, attachments: uploaded });
    for (const attachment of attachments) dispose(attachment);
    setAttachments([]);
    setText("");
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onCardClick = (event: MouseEvent<HTMLFormElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [tabindex]")) return;
    textareaRef.current?.focus();
  };

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    onDragOver?.(event);
    if (event.defaultPrevented) return;
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      setDragging(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    onDrop?.(event);
    setDragging(false);
    if (event.defaultPrevented || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };

  return (
    <Context.Provider
      value={{
        status,
        text,
        acceptedMediaTypes,
        setText,
        attachments,
        addFiles,
        removeFile,
        submit,
        stop: onStop ?? (() => {}),
        textareaRef,
      }}
    >
      <form
        data-slot="prompt-input"
        data-dragging={dragging || undefined}
        onSubmit={onFormSubmit}
        onClick={onCardClick}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "bg-card text-card-foreground flex cursor-text flex-col gap-2 rounded-3xl border p-3 transition-colors",
          dragging && "border-foreground/40 bg-muted",
          className,
        )}
        {...props}
      />
    </Context.Provider>
  );
}

function PromptInputAttachments({ className, ...props }: ComponentProps<"div">) {
  const { attachments, removeFile } = usePrompt();
  if (attachments.length === 0) return null;
  return (
    <div
      data-slot="prompt-input-attachments"
      className={cn("flex flex-wrap gap-2", className)}
      {...props}
    >
      {attachments.map((attachment) => (
        <Attachment
          key={attachment.clientId}
          type={attachment.file.type === "application/pdf" ? "document" : "image"}
          source={attachment.previewUrl}
          fileName={attachment.file.name}
          size={attachment.file.size}
          status={attachment.status}
          error={attachment.error}
          onRemove={() => removeFile(attachment.clientId)}
        />
      ))}
    </div>
  );
}

interface PromptInputTextareaProps extends Omit<
  ComponentProps<typeof Textarea>,
  "value" | "onValueChange" | "variant"
> {
  readonly maxHeightClassName?: string;
}

function PromptInputTextarea({
  className,
  onKeyDown,
  onPaste,
  maxHeightClassName = "max-h-48",
  ...props
}: PromptInputTextareaProps) {
  const { text, setText, submit, addFiles } = usePrompt();

  const handleKeyDown: ComponentProps<typeof Textarea>["onKeyDown"] = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handlePaste: ComponentProps<typeof Textarea>["onPaste"] = (event) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  return (
    <ScrollArea viewportClassName={maxHeightClassName}>
      <Textarea
        data-slot="prompt-input-textarea"
        variant="ghost"
        value={text}
        onValueChange={setText}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        rows={1}
        aria-label="Message"
        className={cn("overflow-hidden md:text-base", className)}
        {...props}
      />
    </ScrollArea>
  );
}

function PromptInputToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-toolbar"
      className={cn("flex items-center justify-between gap-1", className)}
      {...props}
    />
  );
}

function PromptInputAttachmentButton({ className, ...props }: ComponentProps<typeof Button>) {
  const { acceptedMediaTypes, addFiles, status } = usePrompt();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={acceptedMediaTypes.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Attach files"
        disabled={isBusy(status)}
        className={cn("rounded-full", className)}
        onClick={() => input.current?.click()}
        {...props}
      >
        <PaperclipIcon />
      </Button>
    </>
  );
}

function PromptInputSubmit({ className, ...props }: ComponentProps<typeof Button>) {
  const { status, text, attachments, stop } = usePrompt();
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

  const blocked = attachments.some((attachment) => attachment.status !== "ready");
  const hasAttachment = attachments.some((attachment) => attachment.status === "ready");
  return (
    <Button
      type="submit"
      size="icon-sm"
      aria-label="Send"
      disabled={blocked || (text.trim().length === 0 && !hasAttachment)}
      className={cn("rounded-full", className)}
      {...props}
    >
      <SendIcon />
    </Button>
  );
}

export {
  PromptInput,
  PromptInputAttachmentButton,
  PromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
};
