# Decisions

Numbering continues from 003 (D23–D30, research). Each entry: the decision, why, what was verified and where. D34/D35 are the stack decisions discussed with the user; the alternatives they weighed are argued in place.

## D31 — The hierarchy is subject → chapters → lessons → exercises; an exercise is an agent-led thread

A **subject** holds chapters; a **chapter** holds lessons; a **lesson** is the written-document unit (1:1 with a collab document, created with the lesson); a **lesson** holds exercises. An **exercise** is not a document: it is a thread the agent opens — `start` creates a thread anchored to the exercise and appends an assistant message built deterministically from the agent-authored `brief` (context + first question), so the user lands in a conversation already begun. Retries are additional threads on the same exercise; "the exercise's thread" is the newest.

Ordering is an integer `position` resequenced transactionally by the one aggregate repository — numbered lists in the product are literally these integers. Fractional indexing rejected: single-tenant, one write path, low write rate; it buys concurrency we don't have and costs readability everywhere.

Statuses (`not_started | in_progress | done`) live on lessons and exercises and are set by **either** the user (RPC) or the agent (tool) through the same `Subjects` service call.

## D32 — Subject memory: structured columns + skills rows + one agent note with revisions

- Structured: `title/about/motivation/dueAt` as columns; the outline itself is structured memory.
- Skills: `eru_subject_skills(kind: strength|weakness, text, sourceThreadId?)` — a list the agent rewrites wholesale through one tool (`UpdateSkills`), each row pointing at the thread where it was observed.
- The note: `subjects.note`, one text the agent owns and rewrites (`SaveNote`); every rewrite archives the previous value to `eru_subject_note_revisions` so a bad rewrite is recoverable. **Hidden in the UI by default** — exposed only behind an explicit interaction (`subjects.note` rpc), because it is the agent's working memory, not a user document.
- One write path: RPC handlers and tool handlers both call `Subjects.Service`, never repositories — the user and the agent are two actors on the same behaviour, and the auth middleware (005) will slot in above this seam without touching it.

## D33 — Thread anchors are optional, subjects-owned columns on `eru_threads`

`subjectId/chapterId/lessonId/exerciseId`, all nullable; at most one of the three deep anchors set, `subjectId` always set alongside (denormalized for "threads of subject"). A thread with no anchors is **lesson-less mode** — today's plain chat, and the entrypoint for creating subjects or new chapters/lessons from conversation (the subject tools are in the registry even for unanchored threads).

Ownership: chat keeps owning `id/title/timestamps` + messages; the anchor columns are written **only** by the subjects domain's repo (`anchorThread` resolves the parent chain and enforces the invariant in one place). Two domains touch one table but own disjoint columns — the table is a tier-1 shape (D13); behaviour stays one-domain-per-column-set. Dependency direction: `subjects → chat`, never back; the chat domain never learns subjects exist.

## D34 — Editor: BlockNote (on ProseMirror/Yjs), not Lexical, not raw Tiptap

The user's instinct was Lexical (Meta; low-level, powerful) with Tiptap "probably too high level". Researched Aug 2026 (versions and sources in the research notes; key ones: blocknotejs.org/docs/features/server-processing, lexical.dev/docs/collaboration/react):

- **Lexical** 0.49 (still pre-1.0): great core, `@lexical/yjs` works, React 19 fine. But a Notion-style app on Lexical means building the entire block UX (drag handles, slash menu, nested blocks) ourselves, and — decisive for this feature — there is **no headless server-side Lexical story**: nothing converts markdown ↔ a Lexical-shaped Y.Doc in a Worker, which is precisely where our second author (the agent) lives.
- **BlockNote** 0.54: the Notion UX out of the box, Yjs-native, maintained by Yjs-ecosystem contributors, and ships `@blocknote/server-util` — a headless `ServerBlockNoteEditor` with `tryParseMarkdownToBlocks` / `blocksToYXmlFragment` / `yDocToBlocks`: exactly the agent-side machinery, off the shelf.
- **Tiptap v3**: mature, but its agent-editing layer ("AI Toolkit") is a paid platform feature; BlockNote *is* Tiptap/ProseMirror with the Notion layer and the server tooling done, MIT.

"Low level" is the wrong axis here: the leverage is in the server-side document machinery, and only BlockNote has it. BlockNote being ProseMirror-based means dropping to Tiptap/ProseMirror APIs remains possible where we need depth.

## D35 — Sync: a native alchemy Effect-form Durable Object speaking the y-websocket protocol; not Durable Streams (yet), not y-partyserver

One DO per document is the authority on the Y.Doc; clients connect over hibernatable WebSockets; the wire format is the standard y-websocket protocol implemented with `y-protocols` (sync + awareness), so the client is the stock `y-websocket` `WebsocketProvider`.

- **Durable Streams** (ElectricSQL, the user asked): genuinely the best long-term primitive — resumable offset-addressed HTTP streams, one transport for chat tokens *and* doc sync, agent edits replaying to closed tabs; a conformant Cloudflare DO server exists for the base protocol (`@durable-streams/server-cloudflare` 0.1.1). But the **Yjs layer** (`y-durable-streams` 0.2.8: update streams + server-side compaction into snapshots) ships a Node `YjsServer` only — no Workers port as of Aug 2026. Adopting today means porting the compaction server into a DO ourselves, on a beta spec. Decision: not yet; **re-evaluate ~Feb 2027**. The swap surface is narrow by construction: the client provider handed to BlockNote, and the DO's internals behind `RoomClient` — nothing above tier 4 would notice.
- **y-partyserver** 2.2 (Cloudflare-maintained Yjs-on-DO): the obvious library, but it's a class extending partyserver's `Server`, and alchemy's Worker **synthesizes DO classes itself** through `DurableObjectBridge` (verified: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Sources/Rolldown.ts:211-265` generates the entry module and class exports; `Workers/DurableObject.ts` owns bindings + migrations). A foreign DO base class means hand-rolled exports, bindings and migrations outside Infrastructure-as-Layer — two paradigms in one worker. The y-websocket server side is ~150 lines over `y-protocols` with a worked alchemy template to stand on (`repos/alchemy/examples/cloudflare-worker/src/Room.ts`, `website/.../hibernatable-websockets.mdx`). We own it. y-partyserver stays the named fallback if the native DO fights back (its hibernation fixes tell us exactly what to test — 08).
- Alchemy DO facts this leans on, all verified in `repos/alchemy`: Effect-form `Cloudflare.DurableObject<Self>()` with `fetch/alarm/webSocketMessage/webSocketClose` shape; `Cloudflare.upgrade()` (hibernatable accept); `DurableObjectStorage.sql` for the update log; the bridge re-runs the init on every activation (the hibernation-wake reload hook); DO RPC methods callable via `getByName(name)` — the **only** implemented addressing mode (`DurableObject.ts:1199-1207`), so room name = document id. Known gaps accepted: no socket tags at upgrade, no `webSocketError` dispatch, no subprotocol negotiation — none needed for y-websocket.

## D36 — Document authority and projection: DO SQLite is truth; Postgres holds the markdown projection and the backup snapshot

`eru_documents` stores `markdown` (model-facing projection: prompts, `ReadDocument`, future search), `state` (latest CRDT snapshot: cold-start seed and backup), `version`, `updatedBy`. The DO writes both on a debounced alarm; nothing outside the sync path ever reads content from the DO. Version history rides on the DO's own compacted snapshots (actor-tagged, last N + daily) — browsing/revert UI deferred, no schema change needed later. Divergence window = one debounce interval, loses projection freshness only, never content.

## D37 — Agent edits are block-scoped ops applied live in the DO

`EditDocument` carries `append | insertAfter | replaceBlock | deleteBlock` ops with markdown payloads; `ReadDocument` returns markdown annotated with block ids. The DO applies each op as one `Y.transact` (markdown → blocks via `ServerBlockNoteEditor`), fanning out to connected editors mid-chat-run — the live loop the user asked for ("this is the beauty of it"). Block scope is what lets a concurrent human edit in one paragraph survive an agent rewrite of another (whole-document replacement is the canonical way to stomp concurrent edits — Electric's "AI agents as CRDT peers" pattern, Apr 2026). The agent holds an awareness entry while editing ("Agent is editing"). Token-granular streaming inside a block is a `room.ts`-only refinement, deferred.

## D38 — Everything non-streaming moves to Effect RPC at `POST /rpc`; the chat run stays AG-UI SSE

`RpcServer.layerHttp({ group, path: "/rpc", protocol: "http" })` mounts on the existing router (verified rc.111: `unstable/rpc/RpcServer.ts:816-839`; websocket is the *default* protocol, so `"http"` is explicit). Serialization **ndjson** — framed, so a future streaming rpc streams instead of buffering (json collects the whole stream into one array body, `RpcServer.ts:1104-1109`). Contracts are leaf `rpc.ts` submodules of their domains (types/errors + effect only), so the web bundle imports schemas, not repositories. The ad-hoc `/threads` routes and their proxy are **deleted**, replaced by `threads.*` rpcs and one `/api/rpc` proxy route. Client: one `RpcClient` service over `FetchHttpClient` in the web app; domain errors decode to typed instances (`test/rpc/RpcSerialization.test.ts:454-460`). `POST /chat` keeps AG-UI SSE — TanStack `useChat` owns that protocol (D1/D20) — and the collab socket is D35's channel. Auth later is one `RpcMiddleware` with `provides: CurrentUser` on the group; the shape was verified (`RpcMiddleware.ts:264-323`) and nothing here blocks it.

## D39 — Subject-aware runs are composed in tier 3; `Chat`/`Run`/`ThreadRepo` are untouched

The chat route reads the thread's anchors, pulls `SubjectRepo.memory(subjectId)` (+ lesson markdown / exercise brief when deep-anchored), and feeds the subjects domain's pure prompt builder into the existing `system` parameter. Unanchored threads get the plain prompt — but always the subject tools, so any chat can create subjects (lesson-less mode as entrypoint). The registry (tier 3) merges `ChatTools` + `ResearchTools` + `SubjectTools`. The chat domain still sees only `Toolkit` and a `system` string.

## D40 — Deferred, with the seam named

- **Files loaded from threads** (user hold): `eru_subject_files` later; nothing blocks it.
- **Token-granular agent typing** (D37): `room.ts` internal.
- **Document history UI / revert**: snapshots already actor-tagged in the DO (D36).
- **Durable Streams re-evaluation**: ~Feb 2027, or when `y-durable-streams` runs on Workers (D35).
- **Ownership/auth**: still 005; every mutation already flows through `Subjects`/`Documents` services, RPC gets middleware (D38).
- **Sidebar/subject search & pagination**: same posture as D22.
