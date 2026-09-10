# Packages

Two new tier-2 domains, schema growth in tier 1, an RPC surface in tier 3, a Durable Object in tier 4.

```
packages/db             @erudane/db          tier 1  (+ subjects/documents tables, enums, relations)
domains/chat            @erudane/chat        tier 2  (+ rpc.ts leaf; otherwise untouched)
domains/documents       @erudane/documents   tier 2  (new — 05)
domains/subjects        @erudane/subjects    tier 2  (new — 04; depends on chat, documents, db)
entrypoints/http        @erudane/http        tier 3  (+ rpc.ts, registry merge, subject-aware chat route; − threads/route.ts)
apps/api                @erudane/api         tier 4  (+ DocumentRoom DO, RoomClient layer, new service layers)
apps/web                @erudane/web         tier 4  (+ rpc client, subject pages, document editor; − threads server fn & proxy)
```

Dependency edges (all downward or one-direction sideways, no cycles):

```
subjects ──▶ chat        (ThreadRepo for exercise threads; Thread shape)
subjects ──▶ documents   (create doc with lesson; markdown for prompts)
subjects ──▶ db          documents ──▶ db        chat ──▶ db
http ──▶ subjects, documents, chat, db
api  ──▶ http + all domains + db      web ──▶ leaf submodules only (types/errors/tools/rpc) + ui
```

## Root

- Catalog additions: `yjs ^13.6`, `y-protocols ^1.0`, `y-websocket ^3` (web only; the 3.0 major only dropped the bundled Node server we never use), `lib0` (transitive, pinned via catalog for encode/decode helpers), `@blocknote/core 0.54.x` (documents domain + web), `@blocknote/react 0.54.x` (web), `y-prosemirror ^1.3` (core/yjs peer), `linkedom ^0.18` (DOM shim for the parsers under workerd — server-util rejected at spike: hard jsdom import).
- No new scripts; `db:generate` produces this plan's one migration.

## `domains/subjects` — `@erudane/subjects` (04)

```
types.ts  errors.ts  ids.ts        LEAF (effect only)
repo.ts                            SubjectRepo: aggregate repository, drizzle + memory layers
service.ts                         Subjects: the one write path (rpc + tools converge here)
memory.ts                          pure prompt projection (SubjectMemory → system fragment)
exercises.ts                       ExerciseRuns: start/restart (creates + seeds the agent-led thread)
tools.ts                           LEAF: agent tool definitions (CreateSubject … EditDocument)
handlers.ts                        tool handler layer (requires Subjects, Documents, ExerciseRuns)
rpc.ts                             LEAF: SubjectRpcs group (06)
```

Exports: `./types`, `./errors`, `./tools`, `./rpc` (leaves, web-importable), `./repo`, `./service`, `./memory`, `./exercises`, `./handlers`. Deps: `@erudane/db`, `@erudane/chat`, `@erudane/documents`, `effect`.

## `domains/documents` — `@erudane/documents` (05)

```
types.ts  errors.ts                LEAF (effect only): DocumentId, DocumentMeta, RoomEdit ops
repo.ts                            DocumentRepo: eru_documents row, drizzle + memory layers
room.ts                            transport-neutral Yjs room logic (yjs, y-protocols, @blocknote/core + linkedom shim; NO cloudflare)
rooms.ts                           RoomClient contract (Context.Service; implemented in apps/api)
service.ts                         Documents: create, meta/markdown reads, edit → RoomClient
```

Deps: `@erudane/db`, `effect`, `yjs`, `y-protocols`, `y-prosemirror`, `lib0`, `@blocknote/core`, `linkedom`.

## `packages/db` (03)

`schema.ts` grows the six tables + three enums + relations; anchor columns on `eru_threads`. One migration folder. Split `schema.ts` into `schema/chat.ts`/`schema/subjects.ts`/`schema/documents.ts` + `schema/index.ts` now — the "second domain adds tables" day D13 named has arrived.

## `entrypoints/http` (06 + D39)

```
rpc.ts                merged RpcGroup (ThreadRpcs + SubjectRpcs) → handlers → RpcServer.layerHttp
chat/registry.ts      adds SubjectTools to the existing Chat+Research merge; provides handler layers
chat/route.ts         subject-aware system prompt composition (anchors → memory → prompt builder)
threads/route.ts      DELETED
index.ts              mergeAll(health, ChatRoute, RpcRoutes, DocumentsWs route pass-through)
documents/ws.ts       GET /documents/:id/ws → forwards upgrade to the DO stub (binding provided by app)
```

## `apps/api`

```
src/document.ts       Cloudflare.DurableObject<DocumentRoom>()("DocumentRoom", …) wired to room.ts
src/index.ts          hosts the DO (Worker's 3rd type arg), provides: RoomClient live layer
                      (getByName), SubjectRepo/Subjects/ExerciseRuns/DocumentRepo/Documents layers,
                      subject tool handlers — added to the existing per-isolate Layer.build
```

## `apps/web`

```
src/rpc.ts                         Api RpcClient service + ManagedRuntime (06)
src/routes/api/rpc.ts              same-origin proxy (replaces api/threads.ts)
src/routes/subjects.*              list, subject outline (chapters/lessons/exercises, statuses, deadlines)
src/routes/lesson.$lessonId.tsx    BlockNote + WebsocketProvider document page
src/chat/*                         anchored-thread affordances; sidebar loader → rpc client
```

UI scope is deliberately thin in this plan: outline pages, the document editor, exercise start, status toggles, the hidden-note reveal. Polish is its own track.
