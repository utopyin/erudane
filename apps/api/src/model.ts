/**
 * The `LanguageModel` layer for this runtime. Two providers share the OpenAI
 * Responses client: the public API (key) and, in development only, a ChatGPT
 * subscription through the Codex backend (OAuth, see `bun run login:chatgpt`).
 */
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient";
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { ApiEnv } from "./env.js";

const CODEX_URL = "https://chatgpt.com/backend-api/codex";

const Credentials = Schema.fromJsonString(
  Schema.Struct({ access: Schema.String, accountId: Schema.String }),
);

const apiKey = (env: ApiEnv) =>
  OpenAiLanguageModel.layer({ model: env.OPENAI_MODEL }).pipe(
    Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(env.OPENAI_API_KEY) })),
  );

const chatGpt = (env: ApiEnv, credentials: typeof Credentials.Type) =>
  OpenAiLanguageModel.layer({
    model: env.CHATGPT_MODEL,
    // The Codex backend is stateless: nothing is stored server-side and
    // reasoning continuity travels encrypted inside the prompt.
    config: {
      store: false,
      include: ["reasoning.encrypted_content"],
      instructions: "You are Erudane, a learning assistant.",
      reasoning: { effort: "low", summary: "auto" },
    },
  }).pipe(
    Layer.provide(
      OpenAiClient.layer({
        apiUrl: CODEX_URL,
        transformClient: HttpClient.mapRequest(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${credentials.access}`,
            "chatgpt-account-id": credentials.accountId,
            "openai-beta": "responses=experimental",
            originator: "erudane",
          }),
        ),
      }),
    ),
  );

/** ChatGPT subscription when credentials were injected (dev), the API key otherwise. */
export const layer = (env: ApiEnv) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const provider =
        env.CHATGPT_OAUTH === ""
          ? apiKey(env)
          : chatGpt(env, yield* Schema.decodeEffect(Credentials)(env.CHATGPT_OAUTH));
      return provider.pipe(Layer.provide(FetchHttpClient.layer));
    }),
  );
