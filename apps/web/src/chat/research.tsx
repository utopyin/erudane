/**
 * How research shows up in a conversation: a card per `WebSearch` /
 * `FetchPage` call, and one **Sources** strip under a run's final answer,
 * derived from the links the model cited and the pages it read. Nothing here
 * is stored or streamed separately — it is all read off the run's parts.
 */
import type { UIMessage } from "@tanstack/ai-react";
import type { PartRenderers } from "@erudane/ui/ai/message";
import { Badge } from "@erudane/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@erudane/ui/collapsible";
import {
  ChevronDownIcon,
  LinkIcon,
  LoaderIcon,
  PageIcon,
  SearchWebIcon,
  WarningIcon,
} from "@erudane/ui/icons";
import { cn } from "@erudane/ui/utils";
import { ResearchTools } from "@erudane/research/tools";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

type Part = Extract<UIMessage["parts"][number], { type: "tool-call" }>;

type SearchOutput = typeof ResearchTools.WebSearch.successSchema.Type;
type PageOutput = typeof ResearchTools.FetchPage.successSchema.Type;
type Failure = typeof ResearchTools.WebSearch.failureSchema.Type;

/** `part.output` is untyped on the client; these recover the tool's own shape. */
const guard =
  <T,>(schema: Schema.Codec<T, any, never, never>) =>
  (value: unknown): value is T =>
    Schema.is(schema)(value);

const isSearchOutput = guard<SearchOutput>(ResearchTools.WebSearch.successSchema);
const isPageOutput = guard<PageOutput>(ResearchTools.FetchPage.successSchema);
const isFailure = guard<Failure>(ResearchTools.WebSearch.failureSchema);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const pending = (part: Part) => part.state !== "complete" && part.state !== "error";

/** The tool failed, either as a thrown error or as a returned `{ message }`. */
const failure = (part: Part): string | undefined =>
  part.state === "error"
    ? typeof part.output === "string"
      ? part.output
      : "failed"
    : isFailure(part.output)
      ? part.output.message
      : undefined;

function Card({
  part,
  icon,
  title,
  children,
}: {
  readonly part: Part;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  const error = failure(part);
  return (
    <Collapsible
      data-slot="research-card"
      defaultOpen={false}
      className="bg-muted/50 rounded-2xl border text-sm"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-muted-foreground size-4 shrink-0 [&>svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {pending(part) && <LoaderIcon className="text-muted-foreground size-4 animate-spin" />}
        {error !== undefined && (
          <Badge variant="destructive" className="gap-1">
            <WarningIcon />
            Failed
          </Badge>
        )}
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-open/collapsible:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel className="flex flex-col gap-2 px-3 pb-3">
        {error !== undefined ? <p className="text-destructive">{error}</p> : children}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function SearchCard({ part }: { readonly part: Part }) {
  const input = part.input as { query?: string; recency?: string } | undefined;
  const output = isSearchOutput(part.output) ? part.output : undefined;
  return (
    <Card
      part={part}
      icon={<SearchWebIcon />}
      title={
        <>
          <span className="text-muted-foreground">Searched </span>
          {input?.query ?? "…"}
          {input?.recency && <span className="text-muted-foreground"> · past {input.recency}</span>}
        </>
      }
    >
      {output && output.results.length === 0 && (
        <p className="text-muted-foreground">No results.</p>
      )}
      {output && (
        <ol className="flex flex-col gap-2">
          {output.results.map((result) => (
            <li key={result.url} className="flex min-w-0 flex-col">
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="truncate font-medium hover:underline"
              >
                {result.title}
              </a>
              <span className="text-muted-foreground truncate text-xs">{hostOf(result.url)}</span>
              <p className="text-muted-foreground line-clamp-2 text-xs">{result.snippet}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function PageCard({ part }: { readonly part: Part }) {
  const input = part.input as { url?: string } | undefined;
  const output = isPageOutput(part.output) ? part.output : undefined;
  const url = output?.url ?? input?.url ?? "";
  return (
    <Card
      part={part}
      icon={<PageIcon />}
      title={
        <>
          <span className="text-muted-foreground">Read </span>
          {output?.title ?? hostOf(url)}
        </>
      }
    >
      {output && (
        <div className="flex flex-col gap-1">
          <a
            href={output.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-xs hover:underline"
          >
            {output.url}
          </a>
          <span className="text-muted-foreground text-xs">
            {output.content.length.toLocaleString()} characters
            {output.truncated && " · truncated"}
          </span>
        </div>
      )}
    </Card>
  );
}

/** Research cards for the two tools; everything else falls back to the generic card. */
export const renderers: PartRenderers = {
  "tool-call": (part) => {
    switch (part.name) {
      case ResearchTools.WebSearch.name:
        return <SearchCard part={part} />;
      case ResearchTools.FetchPage.name:
        return <PageCard part={part} />;
      default:
        return undefined;
    }
  },
};

export interface Source {
  readonly url: string;
  readonly title: string;
}

const LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;

const normalize = (url: string) => url.replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");

/**
 * Sources of one run: the URLs the model linked in its text, in order of
 * citation, titled from the search results / pages of the same run; then any
 * page it read but did not link. Empty when the run did no research.
 */
export const collectSources = (run: ReadonlyArray<UIMessage>): ReadonlyArray<Source> => {
  const known = new Map<string, string>();
  const read: Array<string> = [];
  let text = "";
  for (const message of run) {
    for (const part of message.parts) {
      if (part.type === "text") text += `${part.content}\n`;
      if (part.type !== "tool-call") continue;
      if (isSearchOutput(part.output)) {
        for (const result of part.output.results) known.set(normalize(result.url), result.title);
      } else if (isPageOutput(part.output)) {
        const url = normalize(part.output.url);
        known.set(url, part.output.title ?? hostOf(url));
        read.push(url);
      }
    }
  }
  if (known.size === 0) return [];

  const out = new Map<string, Source>();
  for (const match of text.matchAll(LINK)) {
    const url = normalize(match[1] ?? "");
    if (url && !out.has(url)) out.set(url, { url, title: known.get(url) ?? hostOf(url) });
  }
  for (const url of read) {
    if (!out.has(url)) out.set(url, { url, title: known.get(url) ?? hostOf(url) });
  }
  return [...out.values()];
};

export function Sources({
  sources,
  className,
}: {
  readonly sources: ReadonlyArray<Source>;
  readonly className?: string;
}) {
  if (sources.length === 0) return null;
  return (
    <div data-slot="sources" className={cn("flex flex-col gap-2", className)}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase">
        <LinkIcon className="size-3.5" />
        Sources
      </div>
      <ol className="flex flex-wrap gap-2">
        {sources.map((source, index) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="bg-muted/50 hover:bg-muted flex max-w-xs items-center gap-2 rounded-full border px-3 py-1 text-xs"
            >
              <span className="text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="truncate font-medium">{source.title}</span>
              <span className="text-muted-foreground truncate">{hostOf(source.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
