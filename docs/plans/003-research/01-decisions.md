# Decisions

Numbering continues from 002 (D12–D22).

## D23 — Two tools: `WebSearch` and `FetchPage`

`WebSearch(query, recency?)` returns up to 5 `{ title, url, snippet }` and nothing else. `FetchPage(url)` returns the page's main content as markdown, capped at 8 000 characters with a `truncated` flag. Search is cheap and snippet-only; the model escalates to a full page only when it needs depth. One "do research" tool (Firecrawl's async agent) was rejected: it polls, takes minutes, and hides from the transcript what was actually read.

Verified: Firecrawl v2 `POST /search` (`query`, `limit`, `sources`, `tbs`, `timeout`, `scrapeOptions`) returns `data.web[] { title, description, url }`; `POST /scrape` (`url`, `formats`, `onlyMainContent`, `timeout`) returns `data { markdown, metadata { title, sourceURL } }`. Bearer auth.

## D24 — Search never scrapes

`scrapeOptions` stays off. Full content on every result is ~5× the tokens of snippets and most results are never read. `FetchPage` is the explicit escalation.

## D25 — Firecrawl client is a tier-1 package, over raw `HttpClient`

`@erudane/firecrawl` is an infrastructure client (same argument as `@erudane/db`): mechanism, no concept. It speaks `/v2` through Effect's `HttpClient` rather than `@mendable/firecrawl-js` — smaller worker bundle, typed `FirecrawlError`, Effect timeouts and retries, no SDK-shaped surface to wrap. The package only exposes the two calls the domain needs; more endpoints are added when a domain needs them.

## D26 — `research` is its own domain

The concept is "finding and reading sources for the assistant". `chat` must not learn about Firecrawl, and `research` must not learn about threads. `domains/research/tools.ts` is a leaf (effect only) exactly like `chat/tools.ts`, so the web app can derive its client tools from the registry without pulling the handlers.

## D27 — Tool failures return to the model

`failureMode: "return"`: a scrape that times out or a 402 from Firecrawl becomes a tool result the model can react to (try another URL, answer from snippets) instead of ending the run with `ChatError`. Errors carry a short `message` only.

## D28 — Cost and size bounds

- `MAX_STEPS` 5 → 8 in `route.ts` (a research answer is typically search → fetch → fetch → answer).
- `streamText({ concurrency: 4 })` already bounds parallel tool calls per step, so a run is at most 32 tool calls; no per-run tool budget yet (deferred, see 03).
- `FetchPage` 8k char cap bounds the tool message stored per thread and what hydration sends; `MAX_CHARS` (100k) in `route.ts` is left as is — it measures the client's transcript, which does not carry tool outputs.
- Firecrawl `timeout`: 15 s search, 20 s scrape, each wrapped in an Effect timeout 5 s longer than that.

## D29 — Citations are inline markdown links, Sources are derived client-side

The research guidance (`research/prompt.ts`, appended to the chat `SYSTEM` string in the entrypoint) asks the model to cite as `[title](url)` inline and to only cite URLs it searched or fetched. The web app derives the **Sources** strip from the run itself: URLs the model linked in its text, resolved to titles from the `WebSearch`/`FetchPage` results of the same run, plus any fetched page not linked. No extra protocol event, nothing new stored.

A "run" on the client is a user message followed by its consecutive assistant messages (one per step); `chat.tsx` groups them.

## D30 — Secret and config

`FIRECRAWL_API_KEY` is read with `Config.redacted` inside `Firecrawl.layer`, provided from the worker init so alchemy binds it as a secret (like `OPENAI_API_KEY`). Missing key → `Firecrawl.layer` fails at init (the worker does not start without it); both `.env.example` and `.env.production.example` gain the variable.
