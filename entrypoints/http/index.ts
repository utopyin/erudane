import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as ChatRoute from "./chat/route";
import * as DocumentsWs from "./documents/ws";
import * as FilesRoute from "./files/route";
import * as RpcRoutes from "./rpc";

/**
 * The API's own public address, provided by the app (the worker knows it via
 * its `self_url` binding). The browser needs it for the document WebSocket —
 * service bindings only cover server-side fetches.
 */
export const PublicUrl: Context.Reference<Effect.Effect<string>> = Context.Reference(
  "@erudane/http/PublicUrl",
  { defaultValue: () => Effect.succeed("") },
);

/** Every HTTP route of the API, as one router layer. Routes require `Run.Service` and `ThreadRepo.Service`. */
export const layer = Layer.mergeAll(
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
  HttpRouter.add(
    "GET",
    "/info",
    Effect.gen(function* () {
      const resolve = yield* PublicUrl;
      const url = yield* resolve;
      return HttpServerResponse.jsonUnsafe({ url });
    }),
  ),
  ChatRoute.layer,
  FilesRoute.layer,
  RpcRoutes.layer,
  DocumentsWs.layer,
);

export * as Http from "./index";
