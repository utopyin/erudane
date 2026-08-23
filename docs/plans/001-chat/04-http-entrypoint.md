# `@erudane/http` — the HTTP entrypoint

Assembles domains into an HTTP surface. For this slice: the tool registry, `POST /chat` speaking AG-UI over SSE, and `GET /health`.

## Registry (`chat/tools.ts` leaf + `chat/registry.ts`)

```ts
// chat/tools.ts — LEAF, importable by apps/web
import { ChatTools } from "@erudane/chat/tools";
export const toolkit = Toolkit.merge(ChatTools.toolkit /*, CoursesTools.toolkit, … */);
export type Tools = typeof toolkit.tools;
export * as Registry from "./tools.js";
```

```ts
// chat/registry.ts
export const layer: Layer.Layer<Chat.Toolkit> = Layer.effect(Chat.Toolkit, Registry.toolkit).pipe(
  Layer.provide(ChatHandlers.layer /*, CoursesHandlers.layer */),
);
```

`Registry.toolkit` is an `Effect<WithHandler<Tools>, never, Tool.HandlersFor<Tools>>`; providing the handler layers discharges the requirement and the resulting `WithHandler` is what `Chat.Service` hands to `streamText`. Adding a domain's tools = one line in each file.

## Router (`index.ts`)

```ts
export const layer = Layer.mergeAll(
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
  ChatRoute.layer,
).pipe(HttpRouter.cors?) // no CORS needed with the proxy; keep off
export * as Http from "./index.js"
```

Requirement surfaced by the layer: `Chat.Service` (from `ChatRoute`). `HttpRouter.toWebHandler` is called in `apps/api`, not here.

## Route (`chat/route.ts`)

```ts
export const layer = HttpRouter.add(
  "POST",
  "/chat",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Agui.RunAgentInput);
    const chat = yield* Chat.Service;
    const input = yield* Agui.toChatInput(body); // wire messages → Prompt.Message[]
    const events = chat.stream(input);
    const sse = Agui.encode({ threadId: body.threadId, runId: body.runId })(events); // Stream<string>
    return HttpServerResponse.stream(Stream.encodeText(sse), {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  }),
);
```

Error policy: decode failures → 400 (`HttpServerResponse` via `HttpRouter` default schema-error handling or explicit `catchTag`). `ChatError` _inside_ the stream cannot change the status anymore; it becomes a trailing `RUN_ERROR` event (`Stream.catchTag` in `Agui.encode`).

## AG-UI codec (`chat/agui.ts`)

Everything TanStack-specific is in this file. Source of truth for the shapes: `@tanstack/ai` 0.48 `types.d.ts` + `@ag-ui/core`; verified by end-to-end scripts during research.

### Inbound — `RunAgentInput`

```ts
const WireContent = Schema.Union([
  Schema.String,
  Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
]);
// v1 accepts text only; image/audio/document parts are rejected with 400 until the domain supports FilePart.

const WireMessage = Schema.Union([
  Schema.Struct({ id: Schema.String, role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ id: Schema.String, role: Schema.Literal("user"), content: WireContent }),
  Schema.Struct({ id: Schema.String, role: Schema.Literal("reasoning"), content: Schema.String }),
  Schema.Struct({
    id: Schema.String,
    role: Schema.Literal("assistant"),
    content: Schema.optional(Schema.String),
    toolCalls: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          type: Schema.Literal("function"),
          function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
        }),
      ),
    ),
  }),
  Schema.Struct({
    id: Schema.String,
    role: Schema.Literal("tool"),
    toolCallId: Schema.String,
    content: Schema.String,
    error: Schema.optional(Schema.String),
  }),
]);

export const RunAgentInput = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.String,
  messages: Schema.Array(WireMessage),
  tools: Schema.optional(Schema.Array(Schema.Unknown)), // client-advertised tools: ignored in v1
  forwardedProps: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
```

`toChatInput` mapping → `Prompt.Message`:

| wire        | Prompt                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system`    | `{ role: "system", content }` (only the first; later ones become user text? → reject with 400 in v1)                                                                                                                             |
| `user`      | `{ role: "user", content: string \| [{type:"text",text}] }`                                                                                                                                                                      |
| `reasoning` | dropped (signature-less reasoning cannot be replayed to the provider)                                                                                                                                                            |
| `assistant` | `{ role: "assistant", content: [ text? , ...toolCalls.map(tc => { type:"tool-call", id: tc.id, name: tc.function.name, params: JSON.parse(tc.function.arguments), providerExecuted: false }) ] }`                                |
| `tool`      | `{ role: "tool", content: [{ type:"tool-result", id: toolCallId, name: <looked up from the preceding assistant toolCalls>, result: JSON.parse(content) ?? content, isFailure: error !== undefined, providerExecuted: false }] }` |

Consecutive `tool` wire messages collapse into one `tool` Prompt message. Final decode with `Schema.decodeUnknownEffect(Schema.Array(Prompt.Message))` so the domain receives validated values.

### Outbound — `ChatEvent` → AG-UI events

Ids: assistant message per step `messageId = \`${runId}-${step}\``; tool result message `\`tool-${toolCallId}\``. Text and reasoning ids from Effect parts are not reused; the AG-UI processor keys on `messageId`.

| `ChatEvent` / part                                          | AG-UI event (spec fields top-level; extras under `metadata.tanstack`)                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| first event                                                 | `RUN_STARTED { threadId, runId }`                                                                                                                                                                                        |
| `StepStart`                                                 | `TEXT_MESSAGE_START { messageId, role: "assistant" }`                                                                                                                                                                    |
| `text-delta { delta }`                                      | `TEXT_MESSAGE_CONTENT { messageId, delta }`                                                                                                                                                                              |
| `text-start` / `text-end`                                   | nothing (message-level START/END come from step markers)                                                                                                                                                                 |
| `reasoning-start`                                           | `REASONING_MESSAGE_START { messageId: \`${messageId}-r${id}\`, role: "reasoning" }`                                                                                                                                      |
| `reasoning-delta`                                           | `REASONING_MESSAGE_CONTENT { messageId: …, delta }`                                                                                                                                                                      |
| `reasoning-end`                                             | `REASONING_MESSAGE_END { messageId: … }`                                                                                                                                                                                 |
| `tool-params-start { id, name }`                            | `TOOL_CALL_START { toolCallId: id, toolCallName: name, parentMessageId: messageId }`                                                                                                                                     |
| `tool-params-delta { id, delta }`                           | `TOOL_CALL_ARGS { toolCallId, delta }`                                                                                                                                                                                   |
| `tool-call { id, name, params }`                            | if no `tool-params-start` was seen for `id`: `TOOL_CALL_START` + `TOOL_CALL_ARGS { delta: JSON.stringify(params) }`; then `TOOL_CALL_END { toolCallId, metadata: { tanstack: { input: params } } }`                      |
| `tool-params-end`                                           | nothing (END is emitted on `tool-call`, which carries the decoded params)                                                                                                                                                |
| `tool-result { id, encodedResult, isFailure, preliminary }` | skip if `preliminary`; `TOOL_CALL_RESULT { messageId: \`tool-${id}\`, toolCallId: id, role: "tool", content: JSON.stringify(encodedResult), metadata: isFailure ? { tanstack: { state: "output-error" } } : undefined }` |
| `tool-approval-request`                                     | not emitted in v1 (no tool declares `needsApproval`); seam: `RUN_FINISHED { outcome: { type: "interrupt", … } }`                                                                                                         |
| `file` / `source` / `response-metadata`                     | dropped in v1                                                                                                                                                                                                            |
| `StepEnd`                                                   | `TEXT_MESSAGE_END { messageId }`; remember `reason`, accumulate `usage`                                                                                                                                                  |
| `MaxStepsReached`                                           | nothing extra; final `RUN_FINISHED` carries `finishReason: "length"`                                                                                                                                                     |
| stream end                                                  | `RUN_FINISHED { threadId, runId, usage: [{ model?, inputTokens, outputTokens, totalTokens }], metadata: { tanstack: { finishReason: map(reason), model } } }`                                                            |
| `ChatError` / defect                                        | `RUN_ERROR { message, code?: reason, metadata: { tanstack: { threadId, runId } } }` then end                                                                                                                             |

`finishReason` map: `stop → "stop"`, `length → "length"`, `content-filter → "content_filter"`, `tool-calls → "tool_calls"`, else `null`.

The encoder is a `Stream.mapAccum` over `ChatEvent` keeping `{ step, messageId, openToolCalls: Set, usage, reason }`, followed by `Stream.map(event => Sse.encoder.write({ _tag: "Event", event: "message", id: undefined, data: JSON.stringify(event) }))`. `event: "message"` makes `Sse.encoder` omit the `event:` line, so the output is exactly `data: {...}\n\n`.

Invariants the client relies on (from `StreamProcessor`): one `RUN_STARTED` first; `TEXT_MESSAGE_START` before any `TEXT_MESSAGE_CONTENT` for that id; `TOOL_CALL_START` before `ARGS`/`END`/`RESULT`; `RUN_FINISHED` or `RUN_ERROR` last and exactly once; every `data:` line is one JSON object with no embedded newlines (`JSON.stringify` guarantees this).
