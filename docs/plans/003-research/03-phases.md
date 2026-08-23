# Phases

One commit per phase; each ends green on `bun run check`.

## Phase 0 — Plan + scaffolding

`docs/plans/003-research`, `packages/firecrawl`, `domains/research` skeletons, env examples, icons.

## Phase 1 — Firecrawl client

`packages/firecrawl/service.ts`.

Verify: scratch script with `FIRECRAWL_API_KEY` from `.env` — `search("effect ts v4 release")` returns 5 results; `scrape` on one of them returns markdown; an unknown host fails with `FirecrawlError` (not a defect).

## Phase 2 — Research domain + registry + runtime

`tools.ts`, `handlers.ts`, `prompt.ts`; registry merge; `route.ts` system/maxSteps; worker provides `Firecrawl.layer`.

Verify: `bun run dev`; `curl -N -X POST /chat` with "What changed in Effect 4 rc.111?" shows `WebSearch` then `FetchPage` tool calls and an answer with `[title](url)` links; `GET /chat?threadId=` hydrates the tool parts with their outputs.

## Phase 3 — Web

`research.tsx` cards + Sources, `chat.tsx` run grouping.

Verify: the search card lists results as links, the fetch card shows title + url (+ "truncated"), the Sources strip appears once under the run's final answer, also after reload. Hand off for review.

## Explicitly deferred

Per-run tool budget (needs a run-scoped service the handlers can read), search with content, Firecrawl's async research agent, images/news sources, caching scraped pages across runs, source favicons.
