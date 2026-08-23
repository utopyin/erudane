/**
 * Tool definitions owned by the research domain.
 *
 * LEAF MODULE: imports only `effect`. Never import `./handlers` or
 * `@erudane/firecrawl` from here — the web app imports this module to type
 * its client tools.
 */
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

const Failure = Schema.Struct({ message: Schema.String });

export const Recency = Schema.Literals(["day", "week", "month", "year"]);

export const SearchResult = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  snippet: Schema.String,
});

export const WebSearch = Tool.make("WebSearch", {
  description:
    "Searches the web and returns up to 5 results with a title, URL and short snippet. " +
    "Use it for anything recent, factual, or outside your training — releases, prices, " +
    "docs, news, people, events. Snippets are short: call FetchPage on a result to read it. " +
    "Prefer specific queries over broad ones; search again with different words if the " +
    "results miss.",
  parameters: Schema.Struct({
    query: Schema.String.annotate({ description: "The search query, as you would type it." }),
    recency: Schema.optionalKey(Recency).annotate({
      description: "Only results published within this window. Omit for no time filter.",
    }),
  }),
  success: Schema.Struct({ results: Schema.Array(SearchResult) }),
  failure: Failure,
  failureMode: "return",
});

export const FetchPage = Tool.make("FetchPage", {
  description:
    "Fetches a web page and returns its main content as markdown, truncated to 8000 " +
    "characters. Use it to read a search result in depth or to open a URL the user gave you. " +
    "Cite pages you used with a markdown link to their URL.",
  parameters: Schema.Struct({
    url: Schema.String.annotate({ description: "Absolute http(s) URL of the page." }),
  }),
  success: Schema.Struct({
    title: Schema.NullOr(Schema.String),
    url: Schema.String,
    content: Schema.String,
    truncated: Schema.Boolean,
  }),
  failure: Failure,
  failureMode: "return",
});

export const toolkit = Toolkit.make(WebSearch, FetchPage);

export * as ResearchTools from "./tools";
