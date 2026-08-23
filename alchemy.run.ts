import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const Api = Cloudflare.Worker("Api", {
  main: "apps/api/src/index.ts",
  env: {
    OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY"),
    OPENAI_MODEL: "gpt-4.1-mini",
  },
});

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
