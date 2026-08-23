import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import Api from "./apps/api/src/index";
import { Hyperdrive } from "./packages/db/infra";
import * as ChatGpt from "./scripts/chatgpt/token";

/**
 * Development-only inference through a ChatGPT subscription: when
 * `.auth/chatgpt.json` exists (see `bun run login:chatgpt`), `CHATGPT_OAUTH`
 * is made visible to the worker's `Config` reads. Absent in deploys.
 */
const chatGptConfig = Layer.unwrap(
  Effect.gen(function* () {
    const dev = yield* Alchemy.ALCHEMY_DEV;
    if (!dev) return Layer.empty;
    const credentials = yield* ChatGpt.fresh;
    if (Option.isNone(credentials)) return Layer.empty;
    const json = yield* Schema.encodeEffect(Schema.fromJsonString(ChatGpt.Credentials))(
      credentials.value,
    );
    return ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ CHATGPT_OAUTH: json }), {
      asPrimary: true,
    });
  }).pipe(Effect.provide([BunFileSystem.layer, FetchHttpClient.layer]), Effect.orDie),
);

export const Website = Cloudflare.Website.Vite("Website", {
  rootDir: "apps/web",
  env: { API: Api },
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
  "Erudane",
  {
    providers: Docker.providers().pipe(
      Layer.provideMerge(Command.providers()),
      Layer.provideMerge(Cloudflare.providers()),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* Api;
    const website = yield* Website;
    const hyperdrive = yield* Hyperdrive;

    return {
      apiUrl: api.url.as<string>(),
      websiteUrl: website.url.as<string>(),
      hyperdriveId: hyperdrive.hyperdriveId,
    };
  }).pipe(Effect.provide(chatGptConfig)),
);
