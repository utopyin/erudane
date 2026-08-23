# `domains/documents` + the collab stack

Lesson documents are **live-collaborative**: the user edits in a Notion-style block editor, the agent edits server-side during chat runs, and each watches the other type. This doc fixes the full stack and where each piece lives in the tiers.

## The stack (researched Aug 2026; argued in 01-decisions D34–D37)

| Layer                    | Choice                                                                                                                                | Version             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CRDT                     | Yjs (pure JS, runs in workerd and the DO)                                                                                             | `yjs` 13.6.x        |
| Editor                   | **BlockNote** (`@blocknote/core`, `@blocknote/react`)                                                                                 | 0.54.x              |
| Agent-side doc machinery | `@blocknote/core` + `@blocknote/core/yjs` headless conversions, linkedom DOM shim (server-util rejected at spike: hard jsdom import)  | 0.54.x              |
| Sync server              | **Alchemy Effect-form Durable Object** (one per document) speaking the y-websocket wire protocol via `y-protocols` (sync + awareness) | `y-protocols` 1.0.x |
| Client provider          | `y-websocket`'s `WebsocketProvider` (protocol-standard, maintained)                                                                   | `y-websocket` 2.x   |
| Transport                | WebSocket, browser → API worker route → DO (`Cloudflare.upgrade()`, hibernatable)                                                     | —                   |

Why not the candidates from the discussion — one line each here, full argument in 01-decisions:

- **Lexical**: excellent low-level core, but we'd rebuild the whole Notion block UX _and_ invent the nonexistent "agent edits a Lexical-shaped Y.Doc headlessly" layer. BlockNote sits on ProseMirror/Yjs where that tooling exists today (`ServerBlockNoteEditor`), from a team that maintains the Yjs ecosystem.
- **Durable Streams (ElectricSQL)**: the right long-term primitive — resumable HTTP, one transport for chat tokens _and_ doc sync, agent edits replay to closed tabs — and a conformant Cloudflare DO server exists for the _base_ protocol. But the **Yjs layer** (`y-durable-streams`' compacting `YjsServer`) targets Node with no Workers port as of Aug 2026. Adopting now means porting compaction ourselves. Re-evaluate in ~6 months; the swap seam (client provider + DO internals, both behind our own contracts) is deliberately narrow.
- **y-partyserver** (Cloudflare's Yjs-on-DO library): the obvious library pick, but it is a **class-based** partyserver `Server` — alchemy's Worker synthesizes DO classes itself through its `DurableObjectBridge` (verified in `Sources/Rolldown.ts:211-265`), so a foreign DO base class steps outside Infrastructure-as-Layer entirely (hand-rolled export, migrations, bindings). The y-websocket wire protocol is small and stable (`y-protocols` implements it; the server side is ~150 lines over it), and we keep one paradigm, full Effect typing, and full ownership. y-partyserver remains the documented fallback if the native DO fights us.

## Who owns what

```
domains/documents (@erudane/documents)          tier 2
  types.ts    LEAF. DocumentId, DocumentMeta, DocumentActor, the RoomEdit op union (below). Closure: effect.
  errors.ts   LEAF. DocumentNotFound, DocRepoError, RoomError.
  repo.ts     DocumentRepo: the Postgres row (create, get, projection write) — drizzle + memory layers.
  room.ts     transport-neutral room logic: Y.Doc lifecycle (load/seed/encode), y-protocols message
              handling (sync1/sync2/update, awareness), edit application via ServerBlockNoteEditor,
              markdown projection. Pure functions + a small state shape; imports yjs, y-protocols,
              @blocknote/core with a linkedom shim. NO cloudflare types, NO alchemy.
  service.ts  Documents service: create (row only; the room cold-starts from `state`), meta/markdown
              reads (Postgres), and edit(documentId, ops) — the agent write path, delegated to RoomClient.
  rooms.ts    RoomClient: Context.Service contract `{ edit, snapshot }` the domain requires but tier 4
              implements (over the DO binding). The inversion that keeps cloudflare out of tier 2.

apps/api                                         tier 4
  src/document.ts  the DO: Cloudflare.DurableObject<DocumentRoom>()("DocumentRoom", …) — wires
                   DurableObjectState/storage + the Hyperdrive-backed projection writer to room.ts;
                   shape: { fetch (upgrade), webSocketMessage, webSocketClose, alarm (debounced save),
                   rpc: edit/snapshot }.
  src/index.ts     hosts the DO class (third type arg of Cloudflare.Worker), mounts the ws route,
                   provides RoomClient's live layer over getByName(documentId).

apps/web
  lesson document route: BlockNote + WebsocketProvider (below).
```

Tool _definitions_ (`ReadDocument`, `EditDocument`) live in `subjects/tools.ts` (04) — the agent reaches documents through subject work; the handlers call `Documents.Service`.

## Alchemy mechanics (verified in `repos/alchemy`)

- Effect-form DO: `Cloudflare.DurableObject<Self>()("DocumentRoom", init)` with outer init resolving `Cloudflare.DurableObjectState` + deps and returning the per-activation runtime (`Workers/DurableObject.ts`). The bridge rebuilds the inner Effect on every activation **including hibernation wake** — exactly the hook `room.ts` needs to reload the doc from storage.
- The API worker hosts it via the Worker's third type parameter and `yield* DocumentRoom` in its init; the binding and class migrations are alchemy's problem (`worker.export` + `DurableObjectBridge`, `Sources/Rolldown.ts:211-265`).
- WebSockets: `Cloudflare.upgrade()` returns `[response, socket]` and `acceptWebSocket`s (hibernatable); `webSocketMessage`/`webSocketClose` land on the shape. The worked chat-room example (`examples/cloudflare-worker/src/Room.ts`, `hibernatable-websockets.mdx`) is the template — sessions rehydrated from `state.getWebSockets()` after wake.
- Agent → DO calls: DO RPC methods on the shape, addressed with **`getByName(documentId)`** — the only addressing mode implemented (`DurableObject.ts:1199-1207`; `idFromName`/`get(id)` are stubbed out). Room name = document id, which is all we need.
- DO → Postgres: the DO runs in the API worker script and sees the same Hyperdrive binding; the projection write opens a short-lived connection like any request. Debounce via the DO alarm.
- Known alchemy gaps we accept: no socket tags at upgrade (irrelevant — every socket on a room DO belongs to that one doc), no `webSocketError` dispatch (close handles cleanup), `upgrade()` does no subprotocol negotiation (y-websocket needs none).

## The document's three representations, and the authority

1. **Y.Doc in the DO** (persisted to DO SQLite via `storage.sql`, one `updates` log compacted into a `snapshot` row on save) — the authority. All writes, human or agent, are Yjs updates applied here and fanned out to connected sockets.
2. **Postgres projection** (`eru_documents.markdown` + `state` + `version` + `updatedBy`, 03) — the durable read model, written by the DO on debounced save: `markdown` from `yDocToBlocks` → `blocksToMarkdown`, `state = Y.encodeStateAsUpdate(doc)`. This is what prompts, `ReadDocument`, and future search read — nothing outside the sync path reads the DO.
3. **Blocks/markdown in flight** — converted at the edges only (`@blocknote/core` conversions server-side, BlockNote's model in the editor). No third stored format.

Cold start: a fresh DO activation loads snapshot + tail updates from its SQLite; a _brand-new_ room (first open ever, or storage lost) seeds from `eru_documents.state`. Postgres is thereby also the backup.

## Live agent editing — the loop the user watches

During a chat run, the `EditDocument` handler (tier-3 registry → `Documents.Service.edit`) calls `RoomClient.edit(documentId, ops)` → DO RPC. Inside the DO, `room.ts` applies each op as a Yjs transaction against the live doc; every connected editor sees it instantly, mid-run, while the chat stream is still going. If nobody is connected, the same path just mutates the doc — no special offline case.

Edit representation (D37 — the technical crux):

- `EditDocument` carries **block-scoped ops**, not whole-document markdown: `append { markdown }`, `insertAfter { blockId, markdown }`, `replaceBlock { blockId, markdown }`, `deleteBlock { blockId }`. `ReadDocument` returns markdown annotated with block ids so the model can target blocks.
- `room.ts` converts op markdown via `tryParseMarkdownToBlocks` and applies inside one `Y.transact` per op. Block-level ops mean a concurrent human edit in paragraph A survives an agent rewrite of paragraph B; whole-fragment replacement would stomp it (the known failure mode; Electric's "AI agents as CRDT peers" pattern).
- The DO sets an **awareness entry** for the agent around the edit call ("Agent is editing" — BlockNote renders collaborator presence natively).
- Token-granular typing inside a block (relative-position anchors, incremental markdown parsing) is a refinement of `room.ts` only — the tool contract already permits repeated `replaceBlock` of the same block, which reads as live rewriting in v1.

## Client (web)

Lesson document route: `new WebsocketProvider(wsUrl, documentId, doc)` → `useCreateBlockNote({ collaboration: { provider, fragment: doc.getXmlFragment("document"), user } })` → `<BlockNoteView>`. Title edits go through RPC (`documents.get`/subject rpcs); content through the socket.

WebSocket path: browser connects **directly to the API worker's public URL** (`GET /documents/:id/ws` — an HttpRouter route that forwards the upgrade request to `getByName(id)`'s stub fetch; `Cloudflare.upgrade()` answers inside the DO). Proxying WS through the TanStack app buys nothing; the worker URL reaches the web env via the existing binding pattern (07), CORS on the upgrade route allows the site origin. In `alchemy dev` everything is localhost (dev-registry proxies pass 101 upgrades through — verified in `WorkerProxy.test.ts`).

## Versions & history

CRDT history comes mechanically: the DO keeps its compacted `snapshot` rows (last N + daily) tagged with `actor` in its SQLite; `eru_documents.version`/`updatedBy` mark projection generations. Browsing/reverting UI is **deferred**; revert is "apply old snapshot as a new update", additive later. This is the "however it makes more sense" resolution: history costs one insert per save now and no schema work later.

## Failure modes, named

- **Hibernation vs in-memory doc**: sockets survive hibernation, the Y.Doc doesn't — the bridge re-runs the init on wake and `room.ts` reloads from SQLite before handling the message. Awareness state is rebuilt by the clients' own 30s awareness heartbeats. This is the one piece y-partyserver had hardened; it's the part to test explicitly (08).
- **DO ↔ Postgres divergence**: projection is debounced; a crash loses ≤ one debounce window of _projection_ (never content — DO SQLite has it). Prompts read slightly stale markdown at worst.
- **Concurrent agent + human on the same block**: block-replace is coarser than text-merge — last writer wins within that block. Accepted for v1; the streaming refinement shrinks the window.
- **workerd bundle**: resolved at spike time. `@blocknote/server-util` imports jsdom unconditionally and never bundles for workerd; the plan's named fallback became the primary: `@blocknote/core`'s conversions with a linkedom `document` shim (`room.ts`), verified live in the DO (markdown → blocks → transact, and blocks → markdown projection).
