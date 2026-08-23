# `@erudane/chat` — the chat domain

Owns: turning a transcript into a streamed assistant turn, including the server-tool loop. Does not own: the tool registry (required as a service), the model (required as `LanguageModel`), persistence, or any wire protocol.

## Types (`types.ts`)

```ts
import type { Prompt, Response, Tool } from "effect/unstable/ai";

export interface ChatInput {
  /** Full transcript, already decoded into Effect AI messages by the caller. */
  readonly messages: ReadonlyArray<Prompt.Message>;
  /** Optional system prompt; prepended if present. */
  readonly system?: string;
  /** Upper bound on model rounds per run. Default 5. */
  readonly maxSteps?: number;
}

export type StepIndex = number & { readonly StepIndex: unique symbol };

/**
 * Entrypoint-neutral event stream. Effect AI parts are re-emitted verbatim
 * inside a step; step markers give adapters a stable boundary per model round.
 */
export type ChatEvent =
  | { readonly _tag: "StepStart"; readonly step: StepIndex }
  | { readonly _tag: "Part"; readonly step: StepIndex; readonly part: Response.StreamPart<any> }
  | {
      readonly _tag: "StepEnd";
      readonly step: StepIndex;
      readonly reason: Response.FinishReason;
      readonly usage: Response.Usage;
    }
  | { readonly _tag: "MaxStepsReached"; readonly step: StepIndex };
```

`Part.part` stays `Response.StreamPart<any>` at the boundary because the registry's tool set is only known at the entrypoint. The service is generic over the toolkit internally; the public event type erases it.

Model this as `Data.TaggedEnum` (skill: internal tagged variants) — `ChatEvent.$match` in the adapter.

## Errors (`errors.ts`)

```ts
export class ChatError extends Schema.TaggedErrorClass<ChatError>()("Chat.Error", {
  step: Schema.Number,
  reason: Schema.String, // AiError.reason._tag
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}
```

Produced by mapping `AiError` at the service seam (`Effect.fn` transform, see SERVICES_LAYERS "Operation Error Helpers"). Tool handler failures **do not** reach this channel — see conventions below.

## Service (`service.ts`)

```ts
export interface Interface {
  readonly stream: (input: ChatInput) => Stream.Stream<ChatEvent, ChatError>;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/chat/Chat") {}

/** The tool registry this domain talks to. Provided by an entrypoint. */
export class Toolkit extends Context.Service<
  Toolkit,
  Toolkit.WithHandler<Record<string, Tool.Any>>
>()("@erudane/chat/Toolkit") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel;
    const toolkit = yield* Toolkit;
    const stream = Effect.fn("Chat.stream")(function* (input: ChatInput) {
      /* loop below */
    });
    return Service.of({ stream });
  }),
);

export * as Chat from "./service.js";
```

Requirements of `layer`: `LanguageModel.LanguageModel`, `Chat.Toolkit`. Nothing else. Handler services are hidden inside the registry layer (`toLayer` captures the context at build time).

### The loop

One run = up to `maxSteps` model rounds. Each round is one `streamText`; its parts are re-emitted as `Part` events and also collected so the next prompt can be built.

```
prompt₀ = system? + messages
for step in 0..maxSteps-1:
  emit StepStart(step)
  parts = []
  for part of model.streamText({ prompt, toolkit, concurrency: 4 }):
    emit Part(step, part); collect part
  finish = parts.last(type == "finish")
  emit StepEnd(step, finish.reason, finish.usage)
  if no part.type == "tool-call" in parts: return          // model is done
  prompt = Prompt.concat(prompt, Prompt.fromResponseParts(parts))
emit MaxStepsReached(maxSteps)
```

Implementation notes:

- Build it as `Stream.unwrap` over an `Effect.gen` that returns `Stream.concat(thisStep, Stream.unwrap(nextStep))`, or with `Stream.paginateChunkEffect` keyed on `(prompt, step)`. Pick whichever keeps the parts-collection `Ref` local to one round.
- `Prompt.fromResponseParts` already merges text/reasoning deltas and emits the `tool` message for tool results (`Prompt.ts`), so the assistant turn is reconstructed without hand-merging.
- `concurrency` bounds parallel tool handlers; `streamText` already guarantees `tool-result` parts precede `finish`.
- Termination on `reason === "tool-calls"` is _not_ sufficient on its own (providers differ); check for `tool-call` parts.
- Interruption: the request abort propagates as fiber interruption through `toWebHandler`; handlers are forked inside `streamText`'s `FiberSet`, so nothing to add.

### Prompt building

`ChatInput.messages` are already `Prompt.Message` values. The entrypoint decodes untrusted JSON with `Schema.decodeUnknownEffect(Schema.Array(Prompt.Message))` after mapping from the wire shape (04). The domain never sees raw JSON.

## Tools (`tools.ts`) — leaf

```ts
export const CurrentTime = Tool.make("CurrentTime", {
  description: "Current UTC date-time, for anything time-relative the learner asks.",
  parameters: Schema.Struct({}),
  success: Schema.Struct({ iso: Schema.String }),
  failureMode: "return",
});

export const toolkit = Toolkit.make(CurrentTime);

export * as ChatTools from "./tools.js";
```

`CurrentTime` is a placeholder so the loop has something real to exercise; it will move or die once the first concept-owning tool exists.

## Handlers (`handlers.ts`)

```ts
export const layer = ChatTools.toolkit.toLayer(
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    return ChatTools.toolkit.of({
      CurrentTime: () =>
        Effect.map(Clock.currentTimeMillis, (ms) => ({ iso: new Date(ms).toISOString() })),
    });
  }),
);
export * as ChatHandlers from "./handlers.js";
```

Produces `Layer<Tool.HandlersFor<{ CurrentTime }>>`. The entrypoint registry provides this to its `Chat.Toolkit` layer.

## Tool conventions

Written here until a `@erudane/tool` package earns its existence.

1. **Definitions are leaves.** `<domain>/tools.ts` imports only `effect`. Handlers live in `<domain>/handlers.ts`; never the reverse.
2. **Names are PascalCase nouns or verb-phrases unique across the registry** (`CurrentTime`, `SearchCourses`). The name is the wire id on every protocol.
3. **`failureMode: "return"` by default.** Expected tool failures are information for the model, not a run failure. Declare them in `failure:` so they are encoded, and keep `Chat.Service`'s error channel to `ChatError`. Use `"error"` only when a failure must abort the run.
4. **`dependencies`/`addDependency` are for per-request services** (the current user, a request-scoped trace). Everything else is provided to the handler layer.
5. **Schemas are JSON-representable**: params and success must round-trip through JSON Schema (`Tool.getJsonSchema`) and Standard Schema, because the same definition types the client. No `Schema.Date`, `Option` or classes at the edge; use ISO strings / nullable.
6. **Describe for the model, not for the reader.** `description` and parameter annotations are prompt text.
