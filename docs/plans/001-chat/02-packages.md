# Packages

Four new workspaces plus changes to `apps/web` and the root. Names follow `@erudane/<dir>`; subpath exports are the import vocabulary (`@erudane/chat/tools`, not root re-exports).

```
domains/chat            @erudane/chat        tier 2
entrypoints/http        @erudane/http        tier 3
apps/api                @erudane/api         tier 4  (Cloudflare Worker)
apps/web                @erudane/web         tier 4  (exists)
```

No tier-1 package is needed for this slice. The first candidate will be `packages/tool` (see D2) or `packages/effect` if we start sharing Config/HttpClient recipes.

## `domains/chat` — `@erudane/chat`

```
domains/chat/
  package.json         exports: "./tools", "./service", "./types", "./errors"
  tsconfig.json        extends ../../tsconfig.json
  tools.ts             LEAF. Tool + Toolkit definitions. Closure: effect only.
  types.ts             ChatInput, ChatEvent, Step
  errors.ts            ChatError union
  service.ts           Chat.Service / Chat.Toolkit tags, layer, the loop
  handlers.ts          toolkit.toLayer({...}) for the tools defined in tools.ts
```

Dependencies: `effect` (catalog). Nothing else.

Export surface per module (AGENTS.md: minimise):

- `tools.ts` → `CurrentTime` (Tool), `toolkit` (Toolkit of this domain's tools); `export * as ChatTools from "./tools.js"`.
- `service.ts` → `Interface`, `Service`, `Toolkit` (service tag for the registry), `layer`; `export * as Chat from "./service.js"`.
- `handlers.ts` → `layer`; `export * as ChatHandlers from "./handlers.js"`.
- `types.ts` → `ChatInput`, `ChatEvent`, `StepIndex`.
- `errors.ts` → `ChatError`, `MaxStepsReached` (informational event, not an error — see 03).

Leaf-submodule claim: `@erudane/chat/tools` imports `effect/Schema` and `effect/unstable/ai/{Tool,Toolkit}` only. It must never import `service.ts` or `handlers.ts`. This is what lets `apps/web` import it.

## `entrypoints/http` — `@erudane/http`

```
entrypoints/http/
  package.json         exports: ".", "./chat/tools", "./chat/agui"
  tsconfig.json
  index.ts             `layer`: the HttpRouter layer for the whole API (chat route + health), Requires: Chat.Service
  chat/
    tools.ts           LEAF. Registry: Toolkit.merge(ChatTools.toolkit, …future domains). Closure: effect + */tools leaves.
    registry.ts        Layer for Chat.Toolkit: builds WithHandler from tools.ts + each domain's handler layer
    agui.ts            Schemas for RunAgentInput + wire messages; decode → ChatInput; encode ChatEvent → AG-UI event; SSE framing
    route.ts           POST /chat: decode body, call Chat.Service.stream, respond with HttpServerResponse.stream
```

Dependencies: `effect`, `@erudane/chat` (and every future domain it assembles).

`index.ts` exports one thing: `layer` (`Layer<HttpRouter…, never, Chat.Service>`), namespaced as `Http`. The app provides `Chat.layer` and everything under it.

## `apps/api` — `@erudane/api`

```
apps/api/
  package.json         deps: effect, @effect/ai-openai, @erudane/http, @erudane/chat ; dev: @cloudflare/workers-types
  tsconfig.json        types: ["@cloudflare/workers-types"]
  src/
    env.ts             `type Env = Cloudflare.InferEnv<typeof Api>` re-exported from alchemy.run.ts
    runtime.ts         compose layers from env: OpenAI model, registry, Chat.layer, Http.layer → HttpRouter.toWebHandler
    index.ts           export default { fetch(request, env) { return runtime(env).handler(request) } }
```

## `apps/web` — `@erudane/web` (changes)

```
apps/web/
  package.json         + @tanstack/ai, @tanstack/ai-react, @erudane/http (for chat/tools)
  src/
    env.ts             already proxies cloudflare:workers env; typed by WebsiteEnv (now includes API)
    chat/
      tools.ts         derive TanStack client tool defs from @erudane/http/chat/tools (Schema.toStandardSchemaV1)
      client.ts        useChat options factory: connection fetchServerSentEvents('/api/chat'), tools
    routes/
      api/chat.ts      server route: ANY → env.API.fetch(request)  (path rewritten /api/chat → /chat)
      chat.tsx         the page: messages list + input, uses useChat
```

## Root

- `package.json` catalog: add `@effect/ai-openai` (same rc as `effect`), `@tanstack/ai`, `@tanstack/ai-react`.
- `alchemy.run.ts`: add `Api` worker, bind it to `Website` via `env: { API: Api }`, export `ApiEnv`.
- `.env` (gitignored): `OPENAI_API_KEY=…`. Add `.env.example`.
- `turbo.json`: unchanged (`check:types` already fans out; each new package gets a `check:types` script).

## Per-package `tsconfig.json`

Same shape as `apps/web/tsconfig.json` minus DOM/JSX for the non-web packages:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["**/*.ts"],
  "compilerOptions": { "lib": ["ES2022"] }
}
```

`apps/api` adds `"types": ["@cloudflare/workers-types"]`. `effect-tsgo` is patched at the root (`prepare`), so each package's `check:types` is `tsc`.
