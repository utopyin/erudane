import { Run } from "@erudane/chat/run";
import { ThreadRepo } from "@erudane/chat/threads";
import { ThreadId } from "@erudane/chat/types";
import * as Alchemy from "alchemy";
import { Documents } from "@erudane/documents/service";
import * as Research from "@erudane/research/prompt";
import * as Memory from "@erudane/subjects/memory";
import { SubjectRepo } from "@erudane/subjects/repo";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Agui from "./agui";
import { toUiMessages } from "./ui";

const MAX_STEPS = 8;
const MAX_MESSAGES = 200;
const MAX_CHARS = 100_000;
const SYSTEM = `You are Erudane, a learning assistant.

When the user is seriously learning something (or wants to start), use the subject tools:
create the subject with its outline, keep statuses and deadlines honest, record strengths
and weaknesses as you observe them, and save your private note whenever this conversation
taught you something worth remembering for the next one.

${Research.guidance}`;

/**
 * The subject fragment of the run's system prompt, composed from the thread's
 * anchors (D39): subject memory, plus the anchored lesson's markdown and/or
 * the exercise brief. An unanchored thread gets none of it — lesson-less mode.
 * A failed read logs and degrades to the plain prompt; it never blocks a run.
 */
const subjectSystem = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const repo = yield* SubjectRepo.Service;
    const documents = yield* Documents.Service;
    const anchors = Option.getOrUndefined(yield* repo.anchorsOf(threadId));
    if (anchors?.subjectId == null) return undefined;
    const memory = yield* repo.memory(anchors.subjectId);
    const lessons = memory.chapters.flatMap((chapter) => chapter.lessons);
    const lesson =
      anchors.lessonId === null
        ? undefined
        : lessons.find((candidate) => candidate.id === anchors.lessonId);
    const exercise =
      anchors.exerciseId === null
        ? undefined
        : lessons
            .flatMap((candidate) => candidate.exercises)
            .find((candidate) => candidate.id === anchors.exerciseId);
    const lessonMarkdown =
      lesson === undefined
        ? undefined
        : yield* documents
            .markdown(lesson.documentId)
            .pipe(Effect.catch(() => Effect.succeed(undefined)));
    return Memory.system({
      memory,
      anchors,
      lessonMarkdown,
      exerciseBrief: exercise?.brief,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("subject memory unavailable; running plain", error).pipe(
        Effect.as(undefined),
      ),
    ),
  );

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

const storageFailed = (error: object) =>
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

    const fragment = yield* subjectSystem(threadId);
    const system = fragment === undefined ? SYSTEM : `${SYSTEM}\n\n${fragment}`;

    // The response body streams after this handler returns; it keeps the
    // request's runtime context (the per-request pool lives on it).
    const runtime = yield* Effect.context<Alchemy.RuntimeContext>();
    const sse = runs
      .start({ threadId, message, system, maxSteps: MAX_STEPS })
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
      "Files.StorageError": storageFailed,
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
      messages: yield* toUiMessages(stored),
      activeRun: null,
      interrupts: null,
    });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Chat.RepoError": storageFailed,
      "Files.FileNotFound": storageFailed,
      "Files.StorageError": storageFailed,
    }),
  ),
);

export const layer = Layer.mergeAll(run, hydrate);
