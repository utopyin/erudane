# Decisions

Each entry: the decision, why, and what was verified (source paths are in `repos/effect` or `node_modules`).

## D1 — Domain services are entrypoint-neutral; protocol adaptation lives in tier 3

`Chat.Service.stream` returns an Effect `Stream<ChatEvent, ChatError>` built from Effect AI's own `Response.StreamPart`s plus step markers. It knows nothing about SSE, AG-UI, TanStack or HTTP. The AG-UI encoding and the request decoding live in `entrypoints/http/chat/agui.ts`.

Why: the same service will later back an RPC surface, background jobs (summaries, grading), or a different UI protocol. Verified: `LanguageModel.streamText` yields `Stream<Response.StreamPart<Tools>, AiError | …>` (`packages/effect/src/unstable/ai/LanguageModel.ts`, `Response.ts:308`).

## D2 — Effect-native `Tool` / `Toolkit` is the tool contract; no `@erudane/tool` package yet

Tools are `Tool.make(...)` values, grouped with `Toolkit.make(...)`, handlers provided with `toolkit.toLayer(...)`. This is already the "RpcGroup + handler layer" shape: the Toolkit is an `Effect` whose requirement is `Tool.HandlersFor<Tools>`; `toLayer` is `Layer.effectContext(toHandlers(build))` (`Toolkit.ts`).

A tier-1 `@erudane/tool` wrapper is deferred until a second domain ships tools and we see which conventions repeat (annotations, naming, `failureMode`). Until then the conventions are written down in [03-chat-domain.md](./03-chat-domain.md#tool-conventions).

## D3 — One source of truth for tools, shared with the client

Tool definitions live in **leaf modules** (`@erudane/chat/tools`, assembled in `@erudane/http/chat/tools`) whose closure reaches only `effect`. The client imports the same module and derives TanStack `toolDefinition`s from it:

- params / success schemas → `Schema.toStandardSchemaV1(...)` (`packages/effect/src/Schema.ts:1299`) — TanStack accepts any Standard Schema (`SchemaInput = StandardJSONSchemaV1 | StandardSchemaV1 | JSONSchema`).
- or `Tool.getJsonSchema(tool)` (`Tool.ts:1654`) when a JSON Schema is preferable.

Verified on the TanStack side: tool typing on the client is pure TS inference from `toolDefinition` schemas; client-side **input** validation does not happen at runtime (only client-tool outputs and interrupt payloads are parsed). So "typesafe via schema parsing" is types-only for server tools — which is exactly what we need, and confirms that Effect RPC would add nothing for the chat stream.

Cost accepted: the web bundle pulls `effect` Schema for tool schemas. Measured in phase 4; if it hurts, the fallback is emitting JSON Schema at build time.

## D4 — The chat domain owns the agent loop, not the registry

`streamText` executes server tools once and **does not call the model again** — there is no `maxSteps` in Effect AI (grep confirmed; `Chat.ts` only persists history). The loop is therefore domain behaviour: re-prompt with `Prompt.concat(prompt, Prompt.fromResponseParts(parts))` while the step produced tool calls and `step < maxSteps`.

The registry is a service the domain _requires_ (`Chat.Toolkit`) and the entrypoint _provides_. The chat domain ships one placeholder tool so the slice is real; future tools live in the domain of their concept (`@erudane/courses/tools`) and are merged in the entrypoint registry with `Toolkit.merge`.

## D5 — Wire protocol is AG-UI over SSE, hand-encoded

TanStack AI ≥ 0.48 speaks AG-UI: `data: {"type":"RUN_STARTED",…}\n\n` events (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `REASONING_MESSAGE_*`, `RUN_FINISHED`, `RUN_ERROR`), request body is `RunAgentInput` (`threadId`, `runId`, flat wire `messages`, advertised `tools`, `forwardedProps`). The client only checks `response.ok` and parses `data:` lines with `JSON.parse`; each `data:` line must be one complete JSON object.

We encode this ourselves in tier 3 with `Sse.encoder` + `HttpServerResponse.stream` instead of depending on `@tanstack/ai` server-side. The format is ~10 event shapes (table in [04-http-entrypoint.md](./04-http-entrypoint.md)); owning it keeps the worker free of the TanStack server package and keeps the mapping auditable.

## D6 — Topology: private API worker, same-origin proxy through the Start app

`apps/api` is a `Cloudflare.Worker` bound into the website as `env.API`; the Start server route `/api/chat` forwards the request with `env.API.fetch(request)`. No CORS, no public URL to leak into the client, and Alchemy's dev registry makes the binding work identically under `alchemy dev` (`LocalWorkerProvider.ts`, workerd service bindings).

`workersDev` stays **on** in v1 so the worker can be curled directly while debugging; flipping it to `false` (binding-only) is a hardening step in phase 5.

## D7 — Provider is composed only in tier 4

`apps/api` builds `OpenAiLanguageModel.layer({ model })` over `OpenAiClient.layer({ apiKey })` over `FetchHttpClient.layer`. `@effect/ai-openai` is a dependency of `apps/api` only. The domain requires the abstract `LanguageModel.LanguageModel`. The key arrives as an Alchemy `Config.redacted("OPENAI_API_KEY")` binding (`secret_text`), read from `.env` at deploy time.

## D8 — Stateless v1

The client keeps the transcript and sends it whole on every run; `threadId` / `runId` are echoed back in `RUN_STARTED` / `RUN_FINISHED`. No persistence, no resume (`GET ?runId=`), no hydration. The `Chat.Service` input is the message list, so adding a thread store later is an entrypoint concern.

## D9 — Deferred, with the seam named

- **Client tools and approvals**: AG-UI `RUN_FINISHED { outcome: { type: 'interrupt' } }` + a resumed POST with `resume: [...]`. Effect side is `Tool.make({ needsApproval })` → `tool-approval-request` part and `tool-approval-response` prompt parts. The codec in tier 3 is where both meet; nothing in the domain blocks it.
- **Structured output**, **reasoning display**, **usage accounting**: reasoning and usage are already mapped in the codec; nothing is displayed yet.
- **dep-map script** for tier enforcement.

## D10 — UI: shadcn (preset `b7ClRmgEa`) + Nucleo icons

`apps/web` initialises shadcn with `bunx shadcn@latest init --preset b7ClRmgEa`; components live in `apps/web/src/components/ui`. Icons are **not** the shadcn default (lucide): they come from the locally installed Nucleo React package (`~/.nucleo/skills`, families core/ui/micro/sharp/pixel), copied as components into `apps/web/src/components/icons/` and customised per the `nucleo-customize` skill (`currentColor`, `strokeWidth` on core/ui outline, `data-color="color-2"` for accents). Chat UI uses the `ui` family at 18px.
