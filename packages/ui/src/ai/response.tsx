/**
 * Markdown body of an assistant turn. While `streaming`, unterminated
 * emphasis / code / links are repaired before parsing so the partial text
 * never flashes raw syntax.
 */
import { useMemo, type ComponentProps } from "react";
import Markdown from "react-markdown";
import remend from "remend";
import remarkGfm from "remark-gfm";

import { cn } from "@erudane/ui/utils";

const plugins = [remarkGfm];

interface ResponseProps extends Omit<ComponentProps<"div">, "children"> {
  readonly children: string;
  readonly streaming?: boolean;
}

function Response({ children, streaming = false, className, ...props }: ResponseProps) {
  const source = useMemo(() => (streaming ? remend(children) : children), [children, streaming]);
  return (
    <div
      data-slot="response"
      data-streaming={streaming || undefined}
      className={cn(
        "text-foreground leading-relaxed wrap-break-word",
        "[&>*+*]:mt-3",
        "[&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-medium",
        "[&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-medium",
        "[&_h3]:font-heading [&_h3]:text-lg [&_h3]:font-medium",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
        "[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
        "[&_hr]:border-border [&_hr]:my-6",
        "[&_code]:bg-muted [&_code]:rounded-md [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em]",
        "[&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-sm",
        "[&_table]:w-full [&_table]:text-sm [&_th]:border-border [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border-border [&_td]:border-b [&_td]:px-2 [&_td]:py-1",
        className,
      )}
      {...props}
    >
      <Markdown remarkPlugins={plugins}>{source}</Markdown>
    </div>
  );
}

export { Response };
