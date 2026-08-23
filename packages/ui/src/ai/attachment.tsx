import { FileIcon, LoaderIcon, XIcon } from "@erudane/ui/icons";
import { cn } from "@erudane/ui/utils";
import type { ComponentProps } from "react";

interface AttachmentProps extends Omit<ComponentProps<"div">, "children"> {
  readonly type: "image" | "document";
  readonly source?: string | undefined;
  readonly fileName?: string | undefined;
  readonly size?: number | undefined;
  readonly status?: "ready" | "uploading" | "error" | undefined;
  readonly error?: string | undefined;
  readonly href?: string | undefined;
  readonly onRemove?: (() => void) | undefined;
}

const formatSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
};

function Attachment({
  type,
  source,
  fileName,
  size,
  status = "ready",
  error,
  href,
  onRemove,
  className,
  ...props
}: AttachmentProps) {
  const label = fileName ?? (type === "document" ? "PDF document" : "Image");
  const content = (
    <>
      {type === "image" && source ? (
        <img src={source} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileIcon className="size-7" />
          <span className="w-full truncate text-xs font-medium">{label}</span>
          {size !== undefined && (
            <span className="text-muted-foreground text-[11px]">{formatSize(size)}</span>
          )}
        </div>
      )}
      {status === "uploading" && (
        <span className="bg-background/65 absolute inset-0 flex items-center justify-center backdrop-blur-[1px]">
          <LoaderIcon className="size-5 animate-spin" />
          <span className="sr-only">Uploading {label}</span>
        </span>
      )}
      {status === "error" && (
        <span
          className="bg-destructive/85 text-primary-foreground absolute inset-x-0 bottom-0 line-clamp-2 px-1.5 py-1 text-[10px] leading-tight"
          role="status"
        >
          {error ?? "Upload failed"}
        </span>
      )}
    </>
  );

  return (
    <div
      data-slot="attachment"
      data-status={status}
      className={cn(
        "bg-muted relative size-24 shrink-0 overflow-hidden rounded-2xl border",
        status === "error" && "border-destructive",
        className,
      )}
      aria-label={label}
      {...props}
    >
      {href && !onRemove ? (
        <a href={href} target="_blank" rel="noreferrer" className="block size-full">
          {content}
        </a>
      ) : (
        content
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="bg-background/85 hover:bg-background absolute top-1 right-1 flex size-6 items-center justify-center rounded-full shadow-sm backdrop-blur-sm"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export { Attachment, formatSize };
export type { AttachmentProps };
