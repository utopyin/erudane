import * as OpenAiClient from "@effect/ai-openai/OpenAiClient";
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel";
import { Chat } from "@erudane/chat/service";
import { Http } from "@erudane/http";
import { layer as registry } from "@erudane/http/chat/registry";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type { ApiEnv } from "./env.js";

const make = (env: ApiEnv) => {
  const model = OpenAiLanguageModel.layer({ model: env.OPENAI_MODEL }).pipe(
    Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(env.OPENAI_API_KEY) })),
    Layer.provide(FetchHttpClient.layer),
  );

  // provideMerge, not provide: toWebHandler satisfies route requirements from
  // the app layer's outputs, so Chat.Service must stay exposed.
  const app = Http.layer.pipe(
    Layer.provideMerge(Chat.layer),
    Layer.provide(Layer.mergeAll(model, registry)),
  );

  return HttpRouter.toWebHandler(app, { disableLogger: true });
};

let cached: ReturnType<typeof make> | undefined;

/** One handler per isolate; `env` is stable for the isolate's lifetime. */
export const runtime = (env: ApiEnv) => (cached ??= make(env));
