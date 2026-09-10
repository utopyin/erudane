# Effect RPC

One RPC surface for everything that is not a chat run or a collab socket: subjects, outline, documents metadata, threads. `POST /chat` stays AG-UI SSE (TanStack owns that protocol, D1/D20); the collab sync channel is its own thing (05). Everything else — including the existing ad-hoc `/threads` JSON routes, which this plan **deletes** — moves to `RpcGroup`s served at `POST /rpc`.

All APIs verified in `repos/effect` rc.111 (`unstable/rpc/*`, `test/rpc/*`); references below are to that source.

## Contracts are leaf submodules of their domain

`domains/subjects/rpc.ts` and `domains/chat/rpc.ts` import only their domain's `types.ts`/`errors.ts` and `effect` — same leaf rule as `tools.ts`, so `apps/web` can import the group for `RpcClient.make` without pulling repositories or drizzle into the bundle. The group carries payload/success/error **schemas already defined in `types.ts`/`errors.ts`** — one source of truth; no DTO layer.

```ts
// domains/chat/rpc.ts  (LEAF)
export const ThreadRpcs = RpcGroup.make(
  Rpc.make("threads.list",   { payload: { limit: Schema.optional(...) }, success: Schema.Array(Thread) }),
  Rpc.make("threads.create", { payload: { title: Schema.optional(Schema.String) }, success: Thread }),
)

// domains/subjects/rpc.ts  (LEAF)
export const SubjectRpcs = RpcGroup.make(
  Rpc.make("subjects.list",    { success: Schema.Array(Subject) }),
  Rpc.make("subjects.get",     { payload: { id: SubjectId }, success: Subject, error: SubjectNotFound }),
  Rpc.make("subjects.create",  { payload: NewSubject, success: Subject }),
  Rpc.make("subjects.update",  { payload: { id: SubjectId, patch: SubjectPatch }, success: Subject, error: SubjectNotFound }),
  Rpc.make("subjects.outline", { payload: { id: SubjectId }, success: Outline, error: SubjectNotFound }),
  Rpc.make("subjects.editOutline", { payload: { id: SubjectId, ops: Schema.Array(OutlineOp) }, success: Outline, error: ... }),
  Rpc.make("subjects.setStatus",   { payload: { ref: ItemRef, status: ItemStatus }, success: Schema.Void, error: ... }),
  Rpc.make("subjects.threads",     { payload: { id: SubjectId }, success: Schema.Array(AnchoredThread) }),
  Rpc.make("subjects.note",        { payload: { id: SubjectId }, success: Schema.String }),        // explicit reveal — hidden by default in UI
  Rpc.make("exercises.start",      { payload: { id: ExerciseId }, success: StartedExercise, error: ... }),
  Rpc.make("documents.get",        { payload: { id: DocumentId }, success: DocumentMeta, error: ... }),
)
```

Notes:

- Dotted tags namespace the client (`client["subjects.list"]()`); `RpcGroup.prefix` exists if we later merge groups (`RpcGroup.ts:387`, `Rpc.ts:783`).
- Errors are the domain's `Schema.TaggedError`s — they decode back to typed instances on the client (`test/rpc/RpcSerialization.test.ts:454-460`), so the UI matches on `_tag` exactly like the server does.
- The subject-mutating rpcs and the agent tools (04) intentionally converge on the same `Subjects` service calls: `subjects.editOutline` and the `EditOutline` tool share the `OutlineOp` schema from `types.ts`. One write path, two actors.
- No streaming rpcs in this plan (live doc/outline updates ride the collab channel, 05). When one is wanted, `RpcSchema.Stream` + ndjson already streams over HTTP (`RpcServer.ts:1026-1126`) — the serialization choice below keeps that door open.

## Server: mounted on the existing router

`RpcServer.layerHttp({ group, path, protocol: "http" })` registers a POST route on the ambient `HttpRouter` (`RpcServer.ts:816-839`, `:1175-1201`) — exactly what `HttpRouter.toHttpEffect` in the worker init already provides (`HttpRouter.ts:617-636`). **`protocol: "http"` explicitly**: the default is websocket, which needs `request.upgrade` from the platform server — not what we want here (the only websocket in the system is the collab DO, 05).

```ts
// entrypoints/http/rpc.ts
const group = ThreadRpcs.merge(SubjectRpcs)

const handlers = group.toLayer({ ... })
// threads.* → chat's ThreadRepo; subjects.*/exercises.*/documents.get → Subjects/ExerciseRuns/Documents services.
// Handler bodies' requirements surface as layer requirements (typetest RpcGroup.tst.ts:26-38) and are
// satisfied by the same service layers the worker init already builds.

export const layer = RpcServer.layerHttp({ group, path: "/rpc", protocol: "http" }).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcSerialization.layerNdjson),
)
```

`Http.layer` becomes `Layer.mergeAll(health, ChatRoute.layer, RpcRoutes.layer)`; `threads/route.ts` is deleted, and the handler-level error mapping (`badRequest`/`storageFailed`) goes with it — RPC serializes typed errors, transport errors are the client's `RpcClientError`.

Serialization: **ndjson** (`RpcSerialization.layerNdjson`). Framed, so a future streaming rpc actually streams instead of buffering (json buffers the whole stream into one array body — `RpcServer.ts:1104-1109`); human-debuggable, no msgpack dependency.

`Database.Runtime`: repositories need the per-request runtime context. `toHttpEffect` threads it through `fetch` exactly as it does for the chat route today; nothing new.

## Client: one service in the web app

Browser → same-origin `/api/rpc` → TanStack proxy route (identical to `routes/api/chat.ts`) → service binding → worker `/rpc`. `routes/api/threads.ts` is replaced by `routes/api/rpc.ts`.

```ts
// apps/web/src/rpc.ts
const Protocol = RpcClient.layerProtocolHttp({ url: "/api/rpc" }).pipe(
  Layer.provide([RpcSerialization.layerNdjson, FetchHttpClient.layer]),
);

export class Api extends Context.Service<
  Api,
  RpcClient.RpcClient<Rpcs<typeof group>, RpcClientError>
>()("@erudane/web/Api") {
  static layer = Layer.effect(Api)(RpcClient.make(group)).pipe(Layer.provide(Protocol));
}
```

(`RpcClient.make` wiring per `test/rpc/RpcSerialization.test.ts:115-125`; the service-wrapped shape per `platform/node/test/fixtures/rpc-e2e.ts:13-24`.) A module-level `ManagedRuntime` holds the layer; TanStack Router loaders and mutation callbacks run `runtime.runPromise(Effect.flatMap(Api, api => api["subjects.outline"]({ id })))`. The `listThreads` server fn is replaced by a loader on this client — same data, one protocol, and SSR still works because the loader runs on the server where `/api/rpc` resolves through the binding.

Error handling in the UI: typed domain errors (`SubjectNotFound`, …) are values to branch on; `RpcClientError` is the "network/server broke" bucket rendered generically.

## Middleware seam (not built now)

Auth (plan 004) becomes one `RpcMiddleware.Service` with `provides: CurrentUser` attached via `group.middleware(Auth)` — handler requirements shrink automatically (`RpcMiddleware.ts:264-323`, `ApplyServices` at `:191`). Nothing in this plan needs to change for that later; it's why every mutation already flows through `Subjects` rather than raw repos.
