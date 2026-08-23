# 003 — Research

The assistant can back an answer with the web. Two server tools, `WebSearch` and `FetchPage`, run on Firecrawl; the model decides when to use them, cites what it used inline, and the web app shows a **Sources** strip under the answer.

The slice adds the second domain (`research`) next to `chat`, and the first tier-1 HTTP client (`@erudane/firecrawl`). Nothing in the agent loop changes: `Chat.stream` already runs tool rounds, the registry already merges toolkits, the client already derives its tool types from the registry.

Read in order:

| Doc                                  | What it fixes                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| [01-decisions.md](./01-decisions.md) | D23–D30: tool surface, token/cost bounds, citations, where the Firecrawl client lives |
| [02-packages.md](./02-packages.md)   | Package map, every file, exports, closures                                            |
| [03-phases.md](./03-phases.md)       | Implementation order, verification, deferred                                          |

Related: [001-chat](../001-chat/README.md) (tool contract, registry), [002-persistence](../002-persistence/README.md) (tool results are stored per thread), [docs/architecture/CONTEXT.md](../../architecture/CONTEXT.md).

## The shape in one picture

```
apps/web                                   apps/api
┌──────────────────────────────┐           ┌─────────────────────────────────────────────────┐
│ MessageParts renderers:      │           │ Run.layer                                       │
│  tool-call WebSearch → card  │  SSE      │   .provide(registry)   Chat.Toolkit =           │
│  tool-call FetchPage → card  │ ◀──────── │      Registry.toolkit  ← ChatTools + ResearchTools
│ Sources strip per run        │           │      handlers          ← ChatHandlers + ResearchHandlers
└──────────────────────────────┘           │   .provide(Firecrawl.layer)  ← FIRECRAWL_API_KEY │
                                           └─────────────────────────────────────────────────┘
                                                       │ POST /v2/search, /v2/scrape
                                                       ▼
                                                 api.firecrawl.dev
```
