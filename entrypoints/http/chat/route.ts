import { Chat } from "@erudane/chat/service";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Agui from "./agui";

const MAX_STEPS = 5;
const MAX_MESSAGES = 200;
const MAX_CHARS = 100_000;

class TooLarge extends Schema.TaggedError<TooLarge>()("ChatRoute.TooLarge", {
  message: Schema.String,
}) {}

const checkSize = (input: Agui.RunAgentInput): Effect.Effect<void, TooLarge> => {
  if (input.messages.length > MAX_MESSAGES) {
    return Effect.fail(new TooLarge({ message: `more than ${MAX_MESSAGES} messages` }));
  }
  const chars = input.messages.reduce(
    (total, message) => total + ("content" in message ? JSON.stringify(message.content).length : 0),
    0,
  );
  return chars > MAX_CHARS
    ? Effect.fail(new TooLarge({ message: `transcript exceeds ${MAX_CHARS} characters` }))
    : Effect.void;
};

/** `POST /chat`: AG-UI `RunAgentInput` in, AG-UI SSE out. */
export const layer = HttpRouter.add(
  "POST",
  "/chat",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Agui.RunAgentInput);
    yield* checkSize(body);
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
      "ChatRoute.TooLarge": (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 413 })),
    }),
  ),
);
