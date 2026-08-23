import { ThreadRepo } from "@erudane/chat/threads";
import * as Ids from "@erudane/chat/ids";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ListQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.FiniteFromString.check(Schema.isBetween({ minimum: 1, maximum: MAX_LIMIT })),
  ),
});

const CreateBody = Schema.Struct({ title: Schema.optional(Schema.String) });

const toJson = (thread: {
  id: string;
  title: string | null;
  createdAt: DateTime.Utc;
  updatedAt: DateTime.Utc;
}) => ({
  id: thread.id,
  title: thread.title,
  createdAt: DateTime.formatIso(thread.createdAt),
  updatedAt: DateTime.formatIso(thread.updatedAt),
});

const badRequest = (message: string) =>
  Effect.succeed(HttpServerResponse.text(message, { status: 400 }));

const storageFailed = (error: { readonly message: string }) =>
  Effect.logError("storage failed", error).pipe(
    Effect.as(HttpServerResponse.text("storage failed", { status: 500 })),
  );

/** `GET /threads?limit=`: most recently active first. */
const list = HttpRouter.add(
  "GET",
  "/threads",
  Effect.gen(function* () {
    const { limit } = yield* HttpServerRequest.schemaSearchParams(ListQuery);
    const repo = yield* ThreadRepo.Service;
    const threads = yield* repo.list({ limit: limit ?? DEFAULT_LIMIT });
    return HttpServerResponse.jsonUnsafe({ threads: threads.map(toJson) });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Chat.RepoError": storageFailed,
    }),
  ),
);

/** `POST /threads`: a new, empty thread with a server-minted id. */
const create = HttpRouter.add(
  "POST",
  "/threads",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(CreateBody);
    const repo = yield* ThreadRepo.Service;
    const thread = yield* repo.create({ id: yield* Ids.threadId, title: body.title });
    return HttpServerResponse.jsonUnsafe(toJson(thread), { status: 201 });
  }).pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(error.message),
      "Chat.RepoError": storageFailed,
    }),
  ),
);

export const layer = Layer.mergeAll(list, create);
