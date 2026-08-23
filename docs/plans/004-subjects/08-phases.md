# Phases

Each phase ends green on `bun run check`, one commit per phase. Phase 1 is a deliberate de-risking spike on the only genuinely novel machinery; everything after it is the established playbook (schema → domain with memory layer → entrypoint → web).

## Phase 0 — Plan + catalog

Commit `docs/plans/004-subjects`; add catalog entries (yjs, y-protocols, y-websocket, blocknote trio, lib0); scaffold `domains/subjects`, `domains/documents` package manifests.

Verify: `bun install`, `bun run check` green.

## Phase 1 — Collab spike (the risk burn-down)

`domains/documents/room.ts` first, as pure functions: Y.Doc ↔ y-protocols messages, markdown → blocks → `Y.transact` via `@blocknote/server-util`, projection to markdown. Then the minimal `DocumentRoom` DO + `/documents/:id/ws` route + a throwaway web page with BlockNote + `WebsocketProvider`.

Verify — the four things D34/D35 bet on, in `alchemy dev`:

1. `@blocknote/server-util` markdown↔blocks paths run under **workerd** (no DOM). If not: the named fallback (DOM shim in the DO, or plain-text Yjs ops behind the same contract) — decided here, not later.
2. Two tabs, one lesson: concurrent edits converge; presence/cursors render.
3. A scratch DO RPC `edit` (`replaceBlock`) lands **live** in both tabs while they type — the agent loop, minus the agent.
4. Hibernation wake: idle past the hibernation window, then type — doc reloads from DO SQLite, no content loss, awareness recovers on heartbeat. (The y-partyserver-hardened case; if workerd-local hibernation can't be forced, verify on a deployed preview before phase 6 rides on it.)

## Phase 2 — Schema

`schema/` split (chat/subjects/documents), six tables + enums + thread anchor columns + relations, `db:generate`, migration committed.

Verify: throwaway `postgres:18` + `db:migrate` → exactly the expected `eru_*` tables; `db:studio` shows FKs and cascades per 03.

## Phase 3 — Documents domain complete

`repo.ts` (drizzle + memory), `service.ts`, `rooms.ts` contract, DO `alarm` save path (SQLite compaction + Postgres projection with `version`/`updatedBy`), cold-start seed from `eru_documents.state`.

Verify: bun script drives `room.ts` end-to-end with `DocumentRepo.memory`; in dev, edit in a tab → after debounce, `eru_documents.markdown` matches the doc; delete DO storage (new room name) → cold-starts from Postgres `state`.

## Phase 4 — Subjects domain

`types/errors/ids`, `SubjectRepo` (drizzle + memory, resequencing, `memory()` single-read, `anchorThread` invariant), `Subjects`, `ExerciseRuns` (create+seed thread via chat's `ThreadRepo`, idempotent start/restart), `memory.ts` prompt builder, `tools.ts` + `handlers.ts`.

Verify: scratch script on the memory layers — outline CRUD renumbers positions; `anchorThread` rejects a lesson from another subject; exercise `start` yields a thread whose first message is the assistant `brief` rendering and sets `in_progress`; note rewrite archives a revision; `replaceSkills` replaces wholesale. Against dev DB: same script through the worker.

## Phase 5 — RPC entrypoint + web data layer

`domains/chat/rpc.ts`, `domains/subjects/rpc.ts`, `entrypoints/http/rpc.ts`, delete `threads/route.ts`; web `rpc.ts` client service, `/api/rpc` proxy, delete `/api/threads` + `listThreads` server fn; sidebar on the client.

Verify: `curl` the ndjson envelope for `threads.list`; sidebar renders through RPC; a `SubjectNotFound` surfaces in the browser as the typed tag; deleted routes 404.

## Phase 6 — The teaching loop

Registry merges subject tools; chat route composes the subject-aware system prompt from anchors (D39); `EditDocument`/`ReadDocument` handlers through `RoomClient`; agent awareness entry.

Verify (dev, real model): (a) lesson-less thread: "I want to learn X by June" → agent `CreateSubject` + outline → visible via `subjects.outline`; (b) lesson-anchored thread beside the open document: ask the agent to expand a section → blocks rewrite **live in the editor during the run**, "Agent is editing" presence shows; (c) `SaveNote`/`UpdateSkills`/`SetStatus` from conversation land in rows; (d) second thread on the same subject sees the memory (asks the model to recall the deadline and a weakness).

## Phase 7 — Web surfaces

Subjects list, subject outline page (statuses, deadlines, exercise start, note behind explicit reveal), lesson document route, anchored-chat affordances (open/attach a thread from lesson or exercise).

Verify: click-through of the whole loop — create subject in chat → outline page → open lesson doc → co-edit with the agent → start exercise → agent-led thread opens mid-conversation. Hand off for user review (per working agreement, no browser QA beyond smoke).

## Phase 8 — Deploy

`bun run deploy`: migration applies (D19), DO class migration (`new_classes`) emitted by alchemy, `API_URL` in the website env; production smoke of phases 1's four checks.

## Deferred (D40)

Files-from-threads, token-granular agent typing, history UI, Durable Streams re-eval (~Feb 2027), auth/ownership (005), search/pagination.
