import { Chat } from "@erudane/chat/service";
import { Http } from "@erudane/http";
import { layer as registry } from "@erudane/http/chat/registry";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type { ApiEnv } from "./env";
import * as Model from "./model";

const make = (env: ApiEnv) => {
  // provideMerge, not provide: toWebHandler satisfies route requirements from
  // the app layer's outputs, so Chat.Service must stay exposed.
  const app = Http.layer.pipe(
    Layer.provideMerge(Chat.layer),
    Layer.provide(Layer.mergeAll(Model.layer(env), registry)),
  );

  return HttpRouter.toWebHandler(app, { disableLogger: true });
};

let cached: ReturnType<typeof make> | undefined;

/** One handler per isolate; `env` is stable for the isolate's lifetime. */
export const runtime = (env: ApiEnv) => (cached ??= make(env));
