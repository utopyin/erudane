import { Firecrawl } from "@erudane/firecrawl/service";
import * as Effect from "effect/Effect";
import { ResearchTools } from "./tools";
import { Layer } from "effect";

const MAX_RESULTS = 5;
const SNIPPET_CHARS = 300;
const PAGE_CHARS = 8_000;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

const toFailure = (error: { readonly message: string }) => Effect.fail({ message: error.message });

/** Handler layer for the research tools; needs a `Firecrawl.Service`. */
export const layer = ResearchTools.toolkit
  .toLayer(
    Effect.gen(function* () {
      const firecrawl = yield* Firecrawl.Service;
      return ResearchTools.toolkit.of({
        WebSearch: ({ query, recency }) =>
          firecrawl.search(query, { limit: MAX_RESULTS, recency }).pipe(
            Effect.map((results) => ({
              results: results.map((result) => ({
                title: result.title,
                url: result.url,
                snippet: clip(result.description.replace(/\s+/g, " ").trim(), SNIPPET_CHARS),
              })),
            })),
            Effect.catch(toFailure),
          ),
        FetchPage: ({ url }) =>
          firecrawl.scrape(url).pipe(
            Effect.map((page) => ({
              title: page.title,
              url: page.url,
              content: page.markdown.slice(0, PAGE_CHARS),
              truncated: page.markdown.length > PAGE_CHARS,
            })),
            Effect.catch(toFailure),
          ),
      });
    }),
  )
  .pipe(Layer.provide(Firecrawl.layer));

export * as ResearchHandlers from "./handlers";
