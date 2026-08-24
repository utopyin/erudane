# `@erudane/chat` — repository and run orchestration

`Chat.Service.stream(input)` is untouched: a pure function from a message list to a `Stream<ChatEvent, ChatError>`. Persistence wraps it.

## Shapes (`types.ts`, additions)

```ts
export const ThreadId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;
export const MessageId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("MessageId"));

export class Thread extends Schema.Class<Thread>("Chat.Thread")({
  id: ThreadId,
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

/** A stored message: Effect AI's Prompt.Message plus identity and order. */
export class StoredMessage extends Schema.Class<StoredMessage>("Chat.StoredMessage")({
  id: MessageId,
  threadId: ThreadId,
  seq: Schema.Int,
  message: Prompt.Message, // Schema.Codec<Message, MessageEncoded> — Prompt.ts:1776
  createdAt: Schema.DateTimeUtc,
}) {}

export interface RunInput {
  readonly threadId: ThreadId;
  readonly message: Prompt.UserMessage; // the one new message
  readonly system?: string;
  readonly maxSteps?: number;
}
```

`ChatEvent` gains the ids the codec needs (D20): `StepStart { step, messageId }` where `messageId` is the id the assistant message of this step **will** be stored under. `Run` mints it before the step starts (`Effect.sync(() => crypto.randomUUID())` — or Effect's `Random` — and threads it through; `Chat.stream` stays unaware: `Run` maps `StepStart` events to attach the id). Tool messages get their own ids at persist time; the codec uses `tool-${toolCallId}` for their AG-UI message id as today.

## Errors (`errors.ts`, additions)

```ts
export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()("Chat.ThreadNotFound", {
  threadId: ThreadId,
}) {}
export class RepoError extends Schema.TaggedError<RepoError>()("Chat.RepoError", {
  message: Schema.String,
  cause: Schema.Defect,
}) {}
```

## `ThreadRepo` (`threads.ts`)

```ts
export interface Interface {
  readonly create: (thread: {
    id: ThreadId;
    title?: string;
  }) => Effect.Effect<Thread, RepoError, Alchemy.RuntimeContext>;
  readonly get: (
    id: ThreadId,
  ) => Effect.Effect<Option.Option<Thread>, RepoError, Alchemy.RuntimeContext>;
  readonly list: (options: {
    limit: number;
  }) => Effect.Effect<ReadonlyArray<Thread>, RepoError, Alchemy.RuntimeContext>;
  readonly messages: (
    id: ThreadId,
  ) => Effect.Effect<ReadonlyArray<StoredMessage>, RepoError, Alchemy.RuntimeContext>;
  /** Appends in order, assigning `seq` after the current max; bumps `updatedAt`. One transaction. */
  readonly append: (
    id: ThreadId,
    messages: ReadonlyArray<{ id: MessageId; message: Prompt.Message }>,
  ) => Effect.Effect<
    ReadonlyArray<StoredMessage>,
    RepoError | ThreadNotFound,
    Alchemy.RuntimeContext
  >;
}

export class Service extends Context.Service<Service, Interface>()("@erudane/chat/ThreadRepo") {}
```

(D16) `Alchemy.RuntimeContext` appears in the interface because the Drizzle layer needs it; the memory layer ignores it.

**Drizzle layer** (`layer`, requires `Database.Service`):

- `create`: `db.insert(threads).values({ id, title }).returning()`.
- `get`: `db.query.threads.findFirst({ where: { id } })` → `Option.fromNullable`.
- `list`: `db.query.threads.findMany({ orderBy: { updatedAt: "desc" }, limit })`.
- `messages`: `db.query.messages.findMany({ where: { threadId }, orderBy: { seq: "asc" } })`, then `Schema.decodeUnknownEffect(Prompt.Message)(row.content)` per row (a decode failure is a `RepoError` — the row was written by us).
- `append`: `db.transaction((tx) => …)`: `SELECT max(seq)` for the thread (`ThreadNotFound` if the thread row is missing), insert rows with `content: Schema.encodeSync(Prompt.Message)(m)` and `role: m.role`, `UPDATE threads SET updated_at = now()`.
- Every drizzle error (`EffectDrizzleQueryError | SqlError`) → `RepoError` via `Effect.mapError`; the `Alchemy.RuntimeContext` requirement stays.

Row ↔ domain mapping lives in this file only (`timestamp mode: "string"` → `DateTime.makeUnsafe`).

**Memory layer** (`memory`, requires nothing): `Ref<HashMap<ThreadId, { thread, messages }>>`, `Clock.currentTimeMillis` for timestamps, same semantics including `ThreadNotFound`. Used by phase-1 scratch verification and available to any future test.

## `Run` (`run.ts`)

```ts
export interface Interface {
  readonly start: (
    input: RunInput,
  ) => Stream.Stream<ChatEvent, ChatError | ThreadNotFound | RepoError, Alchemy.RuntimeContext>;
}
export class Service extends Context.Service<Service, Interface>()("@erudane/chat/Run") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const chat = yield* Chat.Service;
    const repo = yield* ThreadRepo.Service;
    const start = (input: RunInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const history = yield* repo.messages(input.threadId); // [] is fine; ThreadNotFound comes from append
          yield* repo.append(input.threadId, [{ id: mintId(), message: input.message }]);
          const messages = [...history.map((m) => m.message), input.message];
          const parts: Array<Array<Response.StreamPart<any>>> = []; // per step
          return chat.stream({ messages, system: input.system, maxSteps: input.maxSteps }).pipe(
            Stream.map(attachMessageIds), // StepStart gets a minted assistant message id
            Stream.tap(collectParts(parts)), // Part events by step
            Stream.onEnd(persist(input.threadId, parts)), // Stream.ts:10432 — runs after a *successful* end only
          );
        }),
      );
    return { start };
  }),
);
```

`persist` turns each step's parts into `Prompt.fromResponseParts(parts)` (one `AssistantMessage` and, if tools ran, one `ToolMessage` — `Prompt.ts:2052`) and calls `repo.append` once with all of them, using the minted ids for the assistant messages. Partial runs (failure, interruption/stop) persist nothing beyond the user message in v1 — the next run replays cleanly; storing partial assistant text is a follow-up (`Stream.ensuring` and a `status` column).

Requirements of `Run.layer`: `Chat.Service | ThreadRepo.Service`. It is provided with `Layer.provideMerge` in the app so the HTTP layer can see both `Chat.Service` (unused now, kept for stateless consumers) and `Run.Service`.

## Why not fold persistence into `Chat.Service`

`Chat.stream` is the model loop; repositories are storage; `Run` is the use case that joins them. Keeping three services means the loop stays testable with a fake model and no repo, the repo stays testable with no model, and background jobs (summaries, grading) can reuse `ThreadRepo` without dragging the model in.
