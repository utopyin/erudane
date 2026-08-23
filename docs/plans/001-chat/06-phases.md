# Phases

Each phase ends green on `bun run check` (lint + format + `check:types` across the workspace) and with the named manual verification. Commit per phase with the repo's terse style (`feat(chat): …`).

## Phase 0 — Scaffolding

- Root catalog: `@effect/ai-openai` (= effect rc), `@tanstack/ai`, `@tanstack/ai-react`; root `deploy` script.
- Create `domains/chat`, `entrypoints/http`, `apps/api` with `package.json`, `tsconfig.json`, `check:types` script, empty `index.ts`.
- `.env.example` with `OPENAI_API_KEY=`.
- `docs/architecture/CONTEXT.md` (written with this plan) linked from `AGENTS.md` under a short "Architecture" section; also fix the stale `4.0.0-beta.100` mention in `AGENTS.md` (catalog is `rc.111`).

Verify: `bun install`, `bun run check` passes with empty packages.

## Phase 1 — `@erudane/chat`

`types.ts`, `errors.ts`, `tools.ts`, `handlers.ts`, `service.ts` per [03](./03-chat-domain.md).

Verify: a throwaway script under the scratchpad (not committed) that provides `Chat.layer` with a fake `LanguageModel` (`LanguageModel.make` with a stub `streamText`, see `packages/effect/test/unstable/ai/LanguageModel.test.ts` for the pattern) and asserts the loop stops after a tool-free step and after `maxSteps`. Type-level: `Chat.layer`'s requirement is exactly `LanguageModel | Chat.Toolkit`.

## Phase 2 — `@erudane/http`

`chat/tools.ts`, `chat/registry.ts`, `chat/agui.ts`, `chat/route.ts`, `index.ts` per [04](./04-http-entrypoint.md).

Verify: `HttpRouter.toWebHandler` in a scratch script with the fake model; `curl -N -X POST /chat` with a hand-written `RunAgentInput` body prints the event sequence `RUN_STARTED … TEXT_MESSAGE_START … RUN_FINISHED`. Check a `data:` line per event, blank line separators, no `event:` lines.

## Phase 3 — `apps/api` + Alchemy

`src/runtime.ts`, `src/index.ts`, `alchemy.run.ts` changes per [05](./05-runtimes.md).

Verify: `bun run dev`; `curl -N -X POST http://localhost:<api-port>/chat` with a real OpenAI key streams a real answer; ask something that triggers `CurrentTime` and see `TOOL_CALL_*` then a second `TEXT_MESSAGE_START` (step 1).

## Phase 4 — `apps/web`

Proxy route, client tool registry, chat page per [05](./05-runtimes.md).

Verify: in the browser at `/chat`, send a message, see streaming text; ask for the time, see the tool call render with its output; `stop` aborts the stream (server fiber interrupted — check worker logs stop). Note the client bundle delta from importing `effect` Schema (D3).

## Phase 5 — Deploy + hardening

- `bunx alchemy deploy`, open `websiteUrl/chat`, repeat the phase-4 checks against production.
- `workersDev: false` on `Api` (binding-only).
- `createCsrfMiddleware` on the Start app (TanStack warns without it); origin check on `/api/chat`.
- Request limits in the route: max messages, max total characters, `maxSteps` cap from server not client.
- README updates: how to run, env vars, where things live.

## Explicitly deferred (tracked in [01-decisions.md](./01-decisions.md#d9--deferred-with-the-seam-named))

Client tools / approvals, persistence + resume, structured output, reasoning UI, `@erudane/tool` package, `scripts/dep-map.ts`.
