# Packages

## `packages/firecrawl` — `@erudane/firecrawl` (new, tier 1)

```
packages/firecrawl/
  package.json     exports: "./service"
  tsconfig.json
  service.ts       Firecrawl.Service { search, scrape }, `layer` (Config FIRECRAWL_API_KEY + HttpClient),
                   FirecrawlError, request/response Schemas kept file-local
```

Dependencies: `effect`. Requires `HttpClient` (the runtime provides `FetchHttpClient.layer`, as for the model).

Interface:

```ts
search(query: string, options?: { limit?: number; recency?: "day" | "week" | "month" | "year" })
  → Effect<ReadonlyArray<{ title: string; url: string; description: string }>, FirecrawlError>
scrape(url: string)
  → Effect<{ title: string | null; url: string; markdown: string }, FirecrawlError>
```

Closure: effect only.

## `domains/research` — `@erudane/research` (new, tier 2)

```
domains/research/
  package.json     exports: "./tools", "./handlers", "./prompt"
  tsconfig.json
  tools.ts         LEAF (effect only). WebSearch, FetchPage, `toolkit`. `export * as ResearchTools`
  handlers.ts      `layer = toolkit.toLayer(…)`, requires Firecrawl.Service. `export * as ResearchHandlers`
  prompt.ts        `guidance`: the research paragraph of the system prompt. LEAF.
```

Dependencies: `@erudane/firecrawl`, `effect`.

Tool shapes (all `failureMode: "return"`):

```ts
WebSearch  params { query: string; recency?: "day" | "week" | "month" | "year" }
           success { results: Array<{ title; url; snippet }> }
           failure { message: string }
FetchPage  params { url: string }
           success { title: string | null; url: string; content: string; truncated: boolean }
           failure { message: string }
```

Leaf claims: `tools.ts` and `prompt.ts` never import `handlers.ts` or `@erudane/firecrawl`.

## `entrypoints/http` — changes

```
chat/tools.ts      Toolkit.merge(ChatTools.toolkit, ResearchTools.toolkit)   (still a leaf)
chat/registry.ts   Layer.provide([ChatHandlers.layer, ResearchHandlers.layer]); now requires Firecrawl.Service
chat/route.ts      SYSTEM = base + Research.guidance; MAX_STEPS = 8
```

## `apps/api` — changes

```
src/index.ts       Layer.provide(Firecrawl.layer) next to Model.layer (both need FetchHttpClient)
```

`.env.example`, `.env.production.example`: `FIRECRAWL_API_KEY=`.

## `apps/web` — changes

```
src/chat/chat.tsx      groups messages into runs; passes `renderers` and renders <Sources> after each run
src/chat/research.tsx  WebSearch / FetchPage tool cards, `Sources` strip, `collectSources(run)`
```

`@erudane/ui`: icons `SearchWebIcon`, `PageIcon`, `LinkIcon` (Nucleo glyph). No new components: cards are built from `Tool`/`ToolHeader`/`ToolContent`.
