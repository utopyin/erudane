import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as ChatRoute from "./chat/route";
import * as ThreadsRoute from "./threads/route";

/** Every HTTP route of the API, as one router layer. Routes require `Run.Service` and `ThreadRepo.Service`. */
export const layer = Layer.mergeAll(
  HttpRouter.add("GET", "/health", HttpServerResponse.text("ok")),
  ChatRoute.layer,
  ThreadsRoute.layer,
);

export * as Http from "./index";
