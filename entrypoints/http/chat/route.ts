import { Chat } from "@erudane/chat/service";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Agui from "./agui.js";

const MAX_STEPS = 5;

/** `POST /chat`: AG-UI `RunAgentInput` in, AG-UI SSE out. */
export const layer = HttpRouter.add(
  "POST",
  "/chat",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Agui.RunAgentInput);
    const input = yield* Agui.toChatInput(body, { maxSteps: MAX_STEPS });
    const chat = yield* Chat.Service;

    const sse = chat.stream(input).pipe(Agui.encode(body), Stream.encodeText);

    return HttpServerResponse.stream(sse, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 400 })),
      "Agui.UnsupportedInput": (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 400 })),
    }),
  ),
);
