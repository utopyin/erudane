# 001 — Chat, end to end

First vertical slice: a user types in the web app, an OpenAI model answers as a stream, and can call server tools in a multi-step loop. The goal is less the chat itself than the **seams** it forces us to draw: domain ↔ entrypoint ↔ runtime, and the tool contract shared by model, server and client.

Read in order:

| Doc                                              | What it fixes                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [01-decisions.md](./01-decisions.md)             | The decisions taken and why, with what was verified in the vendored/installed sources          |
| [02-packages.md](./02-packages.md)               | The package map, every file, its exports and its closure                                       |
| [03-chat-domain.md](./03-chat-domain.md)         | `@erudane/chat`: service interface, agent loop, tool contract, errors                          |
| [04-http-entrypoint.md](./04-http-entrypoint.md) | `@erudane/http`: router, AG-UI codec (request → Prompt, ChatEvent → SSE)                       |
| [05-runtimes.md](./05-runtimes.md)               | `apps/api` worker, `alchemy.run.ts`, `apps/web` proxy route + chat page + client tool registry |
| [06-phases.md](./06-phases.md)                   | Implementation order, verification per phase, what is explicitly deferred                      |

Related: [docs/architecture/CONTEXT.md](../../architecture/CONTEXT.md) — the tier model this plan follows.

## The shape in one picture

```
apps/web (TanStack Start, CF Worker)                 apps/api (CF Worker)
┌──────────────────────────────────┐   service       ┌───────────────────────────────────────┐
│ /chat page: useChat(              │   binding       │ fetch = HttpRouter.toWebHandler(      │
│   fetchServerSentEvents('/api/chat'),│ ───────────▶ │   Http.layer                          │
│   tools: clientRegistry)          │   env.API       │     .provide(Chat.layer)              │
│ /api/chat route: env.API.fetch()  │                 │     .provide(OpenAiLanguageModel …)   │  tier 4
└──────────────────────────────────┘                 │     .provide(ToolRegistry.layer))     │
          ▲ typed ToolCallPart<tools>                 └───────────────────────────────────────┘
          │ from the same Tool defs                                     │
          │                                   entrypoints/http          │ Chat.Service.stream
          │                 ┌─────────────────────────────────────────┐ ▼
          └──────────────── │ chat/tools.ts   registry (leaf)         │
                            │ chat/agui.ts    RunAgentInput → Prompt  │  tier 3
                            │                 ChatEvent → AG-UI SSE   │
                            │ chat/route.ts   POST /chat              │
                            └─────────────────────────────────────────┘
                                                  │
                            domains/chat          ▼
                            ┌─────────────────────────────────────────┐
                            │ tools.ts    Tool/Toolkit defs (leaf)    │
                            │ service.ts  stream(input) → ChatEvent   │  tier 2
                            │             loop streamText ≤ maxSteps  │
                            └─────────────────────────────────────────┘
                                     requires LanguageModel + Chat.Toolkit
```
