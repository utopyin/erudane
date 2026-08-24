/**
 * The `LanguageModel` layers for this runtime, in two tiers: `smart` for the
 * work that needs real intelligence (the teaching runs — tools, documents,
 * memory), `fast` for mechanical tasks (titles, summaries — anything where
 * latency and cost beat depth). Each tier is a complete `LanguageModel` layer;
 * consumers pick one at composition time.
 *
 * Two providers share the OpenAI Responses client: the public API (key) and,
 * in development only, a ChatGPT subscription through the Codex backend
 * (OAuth, see `bun run login:chatgpt`).
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

interface Tier {
  /** Env key overriding the model id, shared by both providers. */
  readonly config: string;
  readonly model: string;
  readonly effort: "low" | "medium" | "high";
}

const SMART: Tier = { config: "MODEL_SMART", model: "gpt-5.6-sol", effort: "medium" };
const FAST: Tier = { config: "MODEL_FAST", model: "gpt-5.6-luna", effort: "low" };

const apiKey = (model: string, key: Redacted.Redacted) =>
  OpenAiLanguageModel.layer({ model }).pipe(Layer.provide(OpenAiClient.layer({ apiKey: key })));

const chatGpt = (tier: Tier, model: string, credentials: typeof Credentials.Type) =>
  OpenAiLanguageModel.layer({
    model,
    // The Codex backend is stateless: nothing is stored server-side and
    // reasoning continuity travels encrypted inside the prompt.
    config: {
      store: false,
      include: ["reasoning.encrypted_content"],
      instructions: "You are Erudane, a learning assistant.",
      reasoning: { effort: tier.effort, summary: "auto" },
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
const layer = (tier: Tier) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const model = yield* Config.string(tier.config).pipe(Config.withDefault(tier.model));
      const oauth = yield* Config.redacted("CHATGPT_OAUTH").pipe(
        Config.withDefault(Redacted.make("")),
      );
      const provider =
        Redacted.value(oauth) === ""
          ? apiKey(
              model,
              yield* Config.redacted("OPENAI_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
            )
          : chatGpt(tier, model, yield* Schema.decodeEffect(Credentials)(Redacted.value(oauth)));
      return provider.pipe(Layer.provide(FetchHttpClient.layer));
    }).pipe(Effect.orDie),
  );

/** The teacher: subject-aware chat runs, tools, live document editing. */
export const smart = layer(SMART);
/** Mechanical work where latency and cost beat depth. */
export const fast = layer(FAST);
