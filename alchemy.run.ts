import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as ChatGpt from "./scripts/chatgpt/token.js";

/**
 * Development-only inference through a ChatGPT subscription: when
 * `.auth/chatgpt.json` exists (see `bun run login:chatgpt`), the worker gets
 * the credentials as one secret. Empty string otherwise, and always in deploys.
 */
const chatGptCredentials = Effect.gen(function* () {
  const dev = yield* Alchemy.ALCHEMY_DEV;
  if (!dev) return "";
  const credentials = yield* ChatGpt.fresh;
  return Option.isSome(credentials)
    ? yield* Schema.encodeEffect(Schema.fromJsonString(ChatGpt.Credentials))(credentials.value)
    : "";
}).pipe(Effect.provide([BunFileSystem.layer, FetchHttpClient.layer]), Effect.orDie);

export const Api = Cloudflare.Worker(
  "Api",
  Effect.gen(function* () {
    return {
      main: "apps/api/src/index.ts",
      env: {
        OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY").pipe(
          Config.withDefault(Redacted.make("")),
        ),
        OPENAI_MODEL: "gpt-4.1-mini",
        CHATGPT_OAUTH: Redacted.make(yield* chatGptCredentials),
        CHATGPT_MODEL: "gpt-5.4",
      },
    };
  }),
);

export type ApiEnv = Cloudflare.InferEnv<typeof Api>;

export const Website = Cloudflare.Website.Vite("Website", {
  rootDir: "apps/web",
  env: { API: Api },
  memo: {
    include: ["**/*", "../../entrypoints/**/*.ts", "../../domains/**/*.ts"],
    lockfile: true,
  },
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
  "Erudane",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* Api;
    const website = yield* Website;

    return {
      apiUrl: api.url.as<string>(),
      websiteUrl: website.url.as<string>(),
    };
  }),
);
