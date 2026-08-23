# `@erudane/http` and `apps/web`

## Routes

| Method | Path                 | Body / query              | Response                                  | Service        |
| ------ | -------------------- | ------------------------- | ----------------------------------------- | -------------- |
| POST   | `/chat`              | AG-UI `RunAgentInput`     | AG-UI SSE (unchanged format)              | `Run.start`    |
| GET    | `/chat?threadId=`    | `threadId` (UUID)         | `{ messages: UIMessage[], activeRun: null, interrupts: null }` | `ThreadRepo.messages` |
| GET    | `/threads?limit=`    | `limit` (default 50, max 200) | `{ threads: [{ id, title, createdAt, updatedAt }] }` | `ThreadRepo.list` |
| POST   | `/threads`           | `{ title? }`              | `201 { id, … }` (server-minted UUID)      | `ThreadRepo.create` |

`GET /chat` is the **hydration** endpoint: `fetchServerSentEvents(url)` issues `GET url?threadId=…` with `Accept: application/json` when `persistence: true` and the page mounts (`@tanstack/ai-client/dist/esm/connection-adapters.js:300,622`). Same path as the POST, different method — exactly what the `ANY` proxy in `apps/web/src/routes/api/chat.ts` already forwards. The response contract is `ChatHydrationResult` (`connection-adapters.d.ts:173`): `activeRun`/`interrupts` are `null` until D22's resume work.

## `POST /chat` with persistence

1. Decode `RunAgentInput` (existing schema). `threadId` must be a UUID (400 otherwise) — TanStack mints `thread_<random>` ids only when `persistence` is off; our pages always pass one (below).
2. `Agui.toUserMessage(body)`: the last wire message must be `role: "user"`; convert to `Prompt.userMessage`. Everything before it is ignored (D20). If the last message is not a user message (tool-result continuations, which we do not support yet): 400 `Agui.UnsupportedInput`.
3. If the thread does not exist, create it with the client's id (first message of a new chat — the page minted the id). This is the one place a client-minted id enters the database; it is validated as a UUID and `ThreadRepo.create` is idempotent on conflict (`onConflictDoNothing`).
4. `run.start({ threadId, message, maxSteps: MAX_STEPS })` → `Agui.encode(ids)` → SSE, as today.

Error mapping adds `Chat.ThreadNotFound` → 404 and `Chat.RepoError` → 500 (logged, message hidden).

## Codec changes (`chat/agui.ts`)

- `toChatInput` becomes `toUserMessage` (returns `Prompt.UserMessage`); the multi-message mapping moves to `ui.ts` in the other direction.
- `encode`: the assistant `messageId` for step `n` comes from the `StepStart.messageId` event instead of `${runId}-${n}`; everything else (tool-call ids, `tool-${id}` result messages, `${messageId}-r${id}` reasoning ids) is unchanged. Hydration must produce the **same ids** for the same stored messages, or a reload shows the last answer twice.

## Hydration codec (`chat/ui.ts`)

`toUiMessages(stored: ReadonlyArray<StoredMessage>): ReadonlyArray<UIMessage>` — `UIMessage { id, role: 'system'|'user'|'assistant', parts, createdAt?, metadata? }` (`@tanstack/ai/dist/esm/types.d.ts:419`), parts (`:277-323`):

| Stored                                      | UI part                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `UserMessage` text parts                    | `{ type: 'text', content }` on a `role: 'user'` message, id = row id                      |
| `AssistantMessage` `text`                   | `{ type: 'text', content }`                                                               |
| `AssistantMessage` `reasoning`              | `{ type: 'thinking', content }`                                                           |
| `AssistantMessage` `tool-call`              | `{ type: 'tool-call', id, name, arguments: JSON.stringify(params), input: params, state: 'complete' }` |
| following `ToolMessage` `tool-result`       | merged into the matching `tool-call` part: `output: result`, and a `{ type: 'tool-result', toolCallId, content: JSON.stringify(result), state: 'complete' }` part |
| `SystemMessage`                             | skipped (we set the system prompt server-side)                                            |

`ToolCallState` values: `'awaiting-input' | 'input-streaming' | 'input-complete' | 'approval-requested' | 'approval-responded' | 'complete' | 'error'` (`types.d.ts:13`); stored calls are always `complete` (or `error` when the stored result is an error). `metadata.tanstack.createdAt` carries the ISO timestamp. Verified by reading what the client's own stream reducer builds so the hydrated and streamed shapes match; phase 3 compares a hydrated transcript against the live one in DevTools.

## Web

- `/chat` (`routes/chat.tsx`): the empty "Ready when you are." page. On first submit it needs a thread id before the POST goes out: the page mints `crypto.randomUUID()` in a loader (`beforeLoad`) and **redirects** to `/chat/$threadId` — simplest, and the server creates the row on the first run (step 3 above). `POST /threads` exists for the sidebar's "New chat" and for future programmatic creation, but the main path does not depend on it.
- `/chat/$threadId` (`routes/chat.$threadId.tsx`): `useChat({ ...chatOptions, persistence: true, threadId })`. `persistence: true` requires `threadId` at the type level (`ChatPersistenceOptions`, `ai-client/types.d.ts:489`); the client calls `hydrate` on mount and repaints. No loader-side fetch, no `initialMessages`.
- Sidebar (`chat/threads.tsx`): `GET /api/threads` via TanStack Query or a route loader; list of titles (fallback: "New chat · <date>"); current thread highlighted; "New chat" button navigates to `/chat`. Keep it to the ChatGPT-like layout already in place — no rename/delete yet.
- Proxy route `routes/api/threads.ts`: same `ANY` forwarder as `api/chat.ts` with the path rewritten to `/threads`.

Client tool registry, composer, message rendering: unchanged.
