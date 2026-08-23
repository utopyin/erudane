import { Run } from "@erudane/chat/run";
import { ThreadRepo } from "@erudane/chat/threads";
import { ThreadId } from "@erudane/chat/types";
import type { Database } from "@erudane/db/service";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Agui from "./agui";
import { toUiMessages } from "./ui";

const MAX_STEPS = 5;
const MAX_MESSAGES = 200;
const MAX_CHARS = 100_000;
const SYSTEM = "You are Erudane, a learning assistant.";

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

const badRequest = (message: string) =>
  Effect.succeed(HttpServerResponse.text(message, { status: 400 }));

const storageFailed = (error: { readonly message: string }) =>
  Effect.logError("storage failed", error).pipe(
    Effect.as(HttpServerResponse.text("storage failed", { status: 500 })),
  );

/** `POST /chat`: one run on a thread. AG-UI `RunAgentInput` in, AG-UI SSE out. */
const run = HttpRouter.add(
  "POST",
  "/chat",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Agui.RunAgentInput);
    yield* checkSize(body);
    const threadId = yield* Schema.decodeEffect(ThreadId)(body.threadId);
    const message = yield* Agui.toUserMessage(body);
    const repo = yield* ThreadRepo.Service;
    const runs = yield* Run.Service;

    // A new chat's first run creates the thread under the id the page minted.
    yield* repo.create({ id: threadId });

    // The response body streams after this handler returns; it keeps the
    // request's runtime context (the per-request pool lives on it).
    const runtime = yield* Effect.context<Database.Runtime>();
    const sse = runs
      .start({ threadId, message, system: SYSTEM, maxSteps: MAX_STEPS })
      .pipe(Agui.encode(body), Stream.encodeText, Stream.provideContext(runtime));

    return HttpServerResponse.stream(sse, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Agui.UnsupportedInput": (error) => badRequest(error.message),
      "Chat.RepoError": storageFailed,
      "ChatRoute.TooLarge": (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 413 })),
    }),
  ),
);

const HydrateQuery = Schema.Struct({ threadId: ThreadId });

/**
 * `GET /chat?threadId=`: TanStack's hydration probe — the stored transcript as
 * `UIMessage`s. A thread that does not exist yet (the page minted the id, no
 * run has happened) hydrates as empty: the client treats any non-2xx as an error.
 */
const hydrate = HttpRouter.add(
  "GET",
  "/chat",
  Effect.gen(function* () {
    const { threadId } = yield* HttpServerRequest.schemaSearchParams(HydrateQuery);
    const repo = yield* ThreadRepo.Service;
    const stored = yield* repo.messages(threadId);
    return HttpServerResponse.jsonUnsafe({
      messages: toUiMessages(stored),
      activeRun: null,
      interrupts: null,
    });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Chat.RepoError": storageFailed,
    }),
  ),
);

export const layer = Layer.mergeAll(run, hydrate);
