import { Database } from "@erudane/db/service";
import { messages, threads } from "@erudane/db/schema";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Prompt from "effect/unstable/ai/Prompt";
import { RepoError, ThreadNotFound } from "./errors";
import { type MessageId, type NewMessage, StoredMessage, Thread, type ThreadId } from "./types";

/** Thread aggregate: the thread row and its ordered messages. */
export interface Interface {
  /** Idempotent on `id`: creating an existing thread returns it unchanged. */
  readonly create: (thread: {
    readonly id: ThreadId;
    readonly title?: string | undefined;
  }) => Effect.Effect<Thread, RepoError, Database.Runtime>;
  readonly get: (id: ThreadId) => Effect.Effect<Option.Option<Thread>, RepoError, Database.Runtime>;
  readonly list: (options: {
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<Thread>, RepoError, Database.Runtime>;
  readonly messages: (
    id: ThreadId,
  ) => Effect.Effect<ReadonlyArray<StoredMessage>, RepoError, Database.Runtime>;
  /** Appends in order after the thread's last message; bumps `updatedAt`. */
  readonly append: (
    id: ThreadId,
    messages: ReadonlyArray<NewMessage>,
  ) => Effect.Effect<ReadonlyArray<StoredMessage>, RepoError | ThreadNotFound, Database.Runtime>;
}

/**
 * @effect-expect-leaking RuntimeContext
 * `Database.Runtime` is the worker's per-request context; queries open their pool on it.
 */
export class Service extends Context.Service<Service, Interface>()("@erudane/chat/ThreadRepo") {}

const MessageJson = Schema.fromJsonString(Prompt.Message);

const fail = (message: string) => (cause: unknown) => new RepoError({ message, cause });

const toThread = (row: typeof threads.$inferSelect): Thread =>
  new Thread({
    id: row.id as ThreadId,
    title: row.title,
    createdAt: DateTime.makeUnsafe(row.createdAt),
    updatedAt: DateTime.makeUnsafe(row.updatedAt),
  });

const toStored = (row: typeof messages.$inferSelect) =>
  Effect.map(
    Schema.decodeUnknownEffect(Prompt.Message)(row.content).pipe(
      Effect.mapError(fail(`stored message ${row.id} does not decode`)),
    ),
    (message) =>
      new StoredMessage({
        id: row.id as MessageId,
        threadId: row.threadId as ThreadId,
        seq: row.seq,
        message,
        createdAt: DateTime.makeUnsafe(row.createdAt),
      }),
  );

/** Drizzle over the shared database. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service;

    const create: Interface["create"] = (thread) =>
      Effect.gen(function* () {
        const inserted = yield* db
          .insert(threads)
          .values({ id: thread.id, title: thread.title ?? null })
          .onConflictDoNothing()
          .returning();
        const row =
          inserted[0] ?? (yield* db.query.threads.findFirst({ where: { id: thread.id } }));
        return toThread(row!);
      }).pipe(Effect.mapError(fail("create thread")));

    const get: Interface["get"] = (id) =>
      db.query.threads.findFirst({ where: { id } }).pipe(
        Effect.map((row) => Option.map(Option.fromUndefinedOr(row), toThread)),
        Effect.mapError(fail("get thread")),
      );

    const list: Interface["list"] = ({ limit }) =>
      db.query.threads.findMany({ orderBy: { updatedAt: "desc" }, limit }).pipe(
        Effect.map((rows) => rows.map(toThread)),
        Effect.mapError(fail("list threads")),
      );

    const messagesOf: Interface["messages"] = (id) =>
      db.query.messages
        .findMany({ where: { threadId: id }, orderBy: { seq: "asc" } })
        .pipe(Effect.mapError(fail("list messages")), Effect.flatMap(Effect.forEach(toStored)));

    const append: Interface["append"] = (id, items) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const thread = yield* tx.query.threads.findFirst({ where: { id } });
            if (thread === undefined) return yield* new ThreadNotFound({ threadId: id });
            const last = yield* tx.query.messages.findFirst({
              where: { threadId: id },
              orderBy: { seq: "desc" },
            });
            const base = (last?.seq ?? -1) + 1;
            const rows = yield* tx
              .insert(messages)
              .values(
                items.map((item, index) => ({
                  id: item.id,
                  threadId: id,
                  seq: base + index,
                  role: item.message.role,
                  content: JSON.parse(Schema.encodeSync(MessageJson)(item.message)) as unknown,
                })),
              )
              .returning();
            const at = yield* DateTime.now;
            yield* tx
              .update(threads)
              .set({ updatedAt: DateTime.formatIso(at) })
              .where(eq(threads.id, id));
            return rows;
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            Schema.is(ThreadNotFound)(error) ? error : fail("append messages")(error),
          ),
          Effect.flatMap(Effect.forEach(toStored)),
        );

    return Service.of({ create, get, list, messages: messagesOf, append });
  }),
);

interface MemoryThread {
  readonly thread: Thread;
  readonly messages: ReadonlyArray<StoredMessage>;
}

/** In-memory implementation for scratch scripts and tests. Requires nothing. */
export const memory = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make(new Map<ThreadId, MemoryThread>());
    const now = Effect.map(Clock.currentTimeMillis, (millis) => DateTime.makeUnsafe(millis));

    const create: Interface["create"] = (input) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(state)).get(input.id);
        if (existing) return existing.thread;
        const at = yield* now;
        const thread = new Thread({
          id: input.id,
          title: input.title ?? null,
          createdAt: at,
          updatedAt: at,
        });
        yield* Ref.update(state, (map) => new Map(map).set(input.id, { thread, messages: [] }));
        return thread;
      });

    const get: Interface["get"] = (id) =>
      Effect.map(Ref.get(state), (map) => Option.fromUndefinedOr(map.get(id)?.thread));

    const list: Interface["list"] = ({ limit }) =>
      Effect.map(Ref.get(state), (map) =>
        [...map.values()]
          .map((entry) => entry.thread)
          .sort((a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt))
          .slice(0, limit),
      );

    const messagesOf: Interface["messages"] = (id) =>
      Effect.map(Ref.get(state), (map) => map.get(id)?.messages ?? []);

    const append: Interface["append"] = (id, items) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(state);
        const entry = map.get(id);
        if (!entry) return yield* new ThreadNotFound({ threadId: id });
        const at = yield* now;
        const base = entry.messages.length;
        const stored = items.map(
          (item, index) =>
            new StoredMessage({
              id: item.id,
              threadId: id,
              seq: base + index,
              message: item.message,
              createdAt: at,
            }),
        );
        const thread = new Thread({ ...entry.thread, updatedAt: at });
        yield* Ref.set(
          state,
          new Map(map).set(id, { thread, messages: [...entry.messages, ...stored] }),
        );
        return stored;
      });

    return Service.of({ create, get, list, messages: messagesOf, append });
  }),
);

export * as ThreadRepo from "./threads";
