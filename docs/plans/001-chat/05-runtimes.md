# Runtimes — `apps/api`, `alchemy.run.ts`, `apps/web`

## `alchemy.run.ts`

```ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const Api = Cloudflare.Worker("Api", {
  main: "apps/api/src/index.ts",                    // bundled by rolldown; workspace imports resolve normally
  env: {
    OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY"),   // .env at deploy → secret_text binding
    OPENAI_MODEL: "gpt-4.1-mini",                        // plain_text; change per stage later
  },
  // workersDev stays default (on) in v1 for direct curl; flip to false in phase 5
});
export type ApiEnv = Cloudflare.InferEnv<typeof Api>;

export const Website = Cloudflare.Website.Vite("Website", {
  rootDir: "apps/web",
  env: { API: Api },                                // service binding → env.API (Fetcher)
  memo: { include: ["**/*", "../../entrypoints/**/*.ts", "../../domains/**/*.ts"], lockfile: true },
});
export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack("Erudane", { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const api = yield* Api;
    const website = yield* Website;
    return { apiUrl: api.url.as<string>(), websiteUrl: website.url.as<string>() };
  }));
```

Facts this relies on (Alchemy 2.0.0-beta.74, `node_modules/alchemy/src/Cloudflare/Workers/*`): `nodejs_compat` is on by default; `Config` values in `env` are resolved at deploy and bound as secrets; a Worker in `env` becomes a `service` binding typed `Fetcher` by `InferEnv`; `Website.Vite` is a Worker so it accepts `env`; under `alchemy dev` each worker runs in workerd on its own port (from 1337) and bindings resolve through the dev registry.

`memo.include` lists sibling workspaces so editing the domain retriggers the website build (the website imports `@erudane/http/chat/tools`).

## `apps/api`

```ts
// src/runtime.ts
import { FetchHttpClient, HttpRouter } from "effect/unstable/http"
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient"
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel"
import { Chat } from "@erudane/chat/service"
import { Http } from "@erudane/http"
import { Registry } from "@erudane/http/chat/registry"
import type { ApiEnv } from "../../../alchemy.run"

const make = (env: ApiEnv) => {
  const model = OpenAiLanguageModel.layer({ model: env.OPENAI_MODEL }).pipe(
    Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(env.OPENAI_API_KEY) })),
    Layer.provide(FetchHttpClient.layer),
  )
  const app = Http.layer.pipe(
    Layer.provide(Chat.layer),
    Layer.provide(Layer.mergeAll(model, Registry.layer)),
  )
  return HttpRouter.toWebHandler(app, { disableLogger: true })
}

let cached: ReturnType<typeof make> | undefined
export const runtime = (env: ApiEnv) => (cached ??= make(env))
```

```ts
// src/index.ts
export default { fetch: (request: Request, env: ApiEnv) => runtime(env).handler(request) }
```

`env` is stable for the lifetime of an isolate, so memoising the handler per isolate is correct; `toWebHandler` builds the layer lazily on first request and reuses it (`HttpEffect.toWebHandlerLayerWith`). Alternative considered: Alchemy's Effect-worker form (`Cloudflare.Worker(id, props, Effect.gen(...))`) with `Config.redacted` yielded in the init phase — cleaner, but its `fetch` contract vs `HttpRouter` is unverified; revisit once the async form works.

Layer graph (topologically):

```
FetchHttpClient.layer
  └ OpenAiClient.layer({ apiKey })
      └ OpenAiLanguageModel.layer({ model })      → LanguageModel.LanguageModel
ChatHandlers.layer                                → Tool.HandlersFor<ChatTools>
  └ Registry.layer                                → Chat.Toolkit
      └ Chat.layer                                → Chat.Service
          └ Http.layer                            → HttpRouter (web handler)
```

## `apps/web`

### Proxy route — `src/routes/api/chat.ts`

```ts
import { createFileRoute } from "@tanstack/react-router"
import { env } from "@/env"

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        const url = new URL(request.url)
        url.pathname = "/chat"                                  // api worker route
        return env.API.fetch(new Request(url, request))         // streams straight through
      },
    },
  },
})
```

Verified: server-route handlers returning a `Response` are passed through untouched (`createStartHandler.ts` → `handleServerRoutes`), and `cloudflare:workers` env resolves in both Alchemy dev and build. `env.API` is typed `Fetcher` via `WebsiteEnv`.

### Client tool registry — `src/chat/tools.ts`

```ts
import { Schema } from "effect"
import { Tool } from "effect/unstable/ai"
import { toolDefinition } from "@tanstack/ai"
import { Registry } from "@erudane/http/chat/tools"

const toClientTool = <T extends Tool.Any>(tool: T) =>
  toolDefinition({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: Schema.toStandardSchemaV1(tool.parametersSchema),
    outputSchema: Schema.toStandardSchemaV1(tool.successSchema),
  }).client()                                                // server-executed, client only needs the types

export const tools = Object.values(Registry.toolkit.tools).map(toClientTool)
```

Property names verified against `repos/effect/packages/effect/src/unstable/ai/Tool.ts:219-256` (`name`, `description`, `parametersSchema`, `successSchema`, `failureSchema`); `Schema.toStandardSchemaV1` at `Schema.ts:1299`. This gives `useChat` a typed `ToolCallPart` union keyed on tool name: `part.name === "CurrentTime" && part.output?.iso`.

### Chat page — `src/routes/chat.tsx`

```tsx
import { useChat, fetchServerSentEvents } from "@tanstack/ai-react"
import { tools } from "@/chat/tools"

const connection = fetchServerSentEvents("/api/chat")

function ChatPage() {
  const { messages, sendMessage, isLoading, stop, error } = useChat({ connection, tools })
  // render messages[].parts: text → <p>, thinking → collapsible, tool-call → name + state + output
  // input form → sendMessage(text)
}
```

Request the hook sends (verified): `POST /api/chat` with `{ threadId, runId, messages: [...wire], tools: [...], forwardedProps }` and header `X-Run-Id`. Components: shadcn (preset `b7ClRmgEa`) — `Button`, `Textarea`, `ScrollArea`, `Badge`, `Card`; icons from Nucleo `ui` family (D10). Page composition lives in `src/chat/` (`Messages`, `MessagePart`, `Composer`), the route file only mounts it.

### `env.ts`

Already present and correct (`Proxy` over `cloudflare:workers` env typed by `WebsiteEnv`). Nothing to change except the type now including `API`.

## Local dev and deploy

- `bun run dev` → `alchemy dev`: builds both workers in workerd, website on `:1337`, api on the next port; `.env` supplies `OPENAI_API_KEY`.
- `bunx alchemy deploy` (add a root `deploy` script) → stage `dev_<user>` by default; outputs `apiUrl`, `websiteUrl`.
- `bunx alchemy destroy` to tear down.
