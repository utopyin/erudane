# 003 — Subjects

A **subject** is what the user is learning: an outline of chapters → lessons → exercises, a deadline, why they're learning it, what they're strong and weak at, and the agent's private working note. Threads attach to any level of it (or to nothing — plain chat stays, as the entrypoint for creating subjects from conversation). Lessons are **live-collaborative documents**: the user edits in a Notion-style editor while the agent, mid-chat-run, edits the same document through tools and the user watches it type. Exercises are **agent-led threads** — opened already-in-progress from an agent-authored brief.

Read in order:

| Doc                                                | What it fixes                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [01-decisions.md](./01-decisions.md)               | D31–D40: the model, the editor (BlockNote over Lexical), the sync stack (native Effect DO over y-partyserver / Durable Streams), RPC scope |
| [02-packages.md](./02-packages.md)                 | Package map: two new domains, every file, dependency edges                                                                                 |
| [03-schema.md](./03-schema.md)                     | Six tables, three enums, thread anchor columns                                                                                             |
| [04-subjects-domain.md](./04-subjects-domain.md)   | `@erudane/subjects`: aggregate repo, one write path, exercise threads, tools, subject-aware runs                                           |
| [05-documents-collab.md](./05-documents-collab.md) | `@erudane/documents` + the collab stack: BlockNote, Yjs, the DocumentRoom DO, live agent editing                                           |
| [06-rpc.md](./06-rpc.md)                           | Effect RPC at `POST /rpc`: leaf contracts, ndjson, one web client; `/threads` routes deleted                                               |
| [07-runtimes.md](./07-runtimes.md)                 | Worker init with the DO, RoomClient inversion, `API_URL` to the browser, dev loop                                                          |
| [08-phases.md](./08-phases.md)                     | Order of work; phase 1 is the collab spike that burns down the only real risk                                                              |

Related: [002-persistence](../002-persistence/README.md) (db + repositories this builds on), [003-research](../003-research/README.md) (tool registry pattern), [001-chat](../001-chat/README.md), [docs/architecture/CONTEXT.md](../../architecture/CONTEXT.md).

## The shape in one picture

```
apps/web                                     apps/api (one worker + one DO class)
┌─────────────────────────────────┐          ┌──────────────────────────────────────────────┐
│ subjects pages ── RpcClient ────┼─POST /api/rpc─▶ RpcServer (threads.* subjects.* docs.*)  │
│ chat pages ───── useChat ───────┼─POST /api/chat─▶ AG-UI run (subject-aware system prompt, │
│                                 │          │        registry: Chat+Research+SubjectTools)    │
│ lesson editor ── BlockNote ─────┼─wss /documents/:id/ws──▶ DocumentRoom DO (per document)  │
│                  + y-websocket  │          │        ▲ Y.Doc authority, DO SQLite log       │
└─────────────────────────────────┘          │        │ EditDocument tool → RoomClient RPC   │
                                             │        └ debounced projection ↓               │
     domains: subjects ──▶ chat, documents   │   Postgres: eru_subjects/chapters/lessons/    │
              (chat never imports subjects)  │   exercises/skills/notes + eru_documents      │
                                             └──────────────────────────────────────────────┘
```

The three channels stay distinct on purpose: RPC for request/response, AG-UI SSE for the chat run, the Yjs socket for document sync. Memory flows into a run as a tier-3-composed system prompt; it flows out of a run as tool calls into the one `Subjects` write path shared with the user's RPCs.
