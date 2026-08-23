/**
 * The `LanguageModel` layer for this runtime. Two providers share the OpenAI
 * Responses client: the public API (key) and, in development only, a ChatGPT
 * subscription through the Codex backend (OAuth, see `bun run login:chatgpt`).
 */
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient";
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

const CODEX_URL = "https://chatgpt.com/backend-api/codex";

const Credentials = Schema.fromJsonString(
  Schema.Struct({ access: Schema.String, accountId: Schema.String }),
);

const apiKey = (model: string, key: Redacted.Redacted) =>
  OpenAiLanguageModel.layer({ model }).pipe(Layer.provide(OpenAiClient.layer({ apiKey: key })));

const chatGpt = (model: string, credentials: typeof Credentials.Type) =>
  OpenAiLanguageModel.layer({
    model,
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

/**
 * ChatGPT subscription when credentials were injected (dev), the API key
 * otherwise. Every `Config` read here runs in the worker's init, so alchemy
 * binds the values as secrets at plan time and resolves them at runtime.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const oauth = yield* Config.redacted("CHATGPT_OAUTH").pipe(
      Config.withDefault(Redacted.make("")),
    );
    const provider =
      Redacted.value(oauth) === ""
        ? apiKey(
            yield* Config.string("OPENAI_MODEL").pipe(Config.withDefault("gpt-4.1-mini")),
            yield* Config.redacted("OPENAI_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
          )
        : chatGpt(
            yield* Config.string("CHATGPT_MODEL").pipe(Config.withDefault("gpt-5.4")),
            yield* Schema.decodeEffect(Credentials)(Redacted.value(oauth)),
          );
    return provider.pipe(Layer.provide(FetchHttpClient.layer));
  }).pipe(Effect.orDie),
);
