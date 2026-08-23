import { documents } from "@erudane/db/schema";
import { Database } from "@erudane/db/service";
import { eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { DocumentNotFound, RepoError } from "./errors";
import { type DocumentActor, type DocumentId, DocumentMeta } from "./types";

export interface Projection {
  readonly markdown: string;
  /** `Y.encodeStateAsUpdate` of the whole doc — the cold-start seed. */
  readonly state: Uint8Array;
  readonly updatedBy: DocumentActor;
}

export interface Interface {
  /** Idempotent on `id`: creating an existing document returns it unchanged. */
  readonly create: (document: {
    readonly id: DocumentId;
    readonly title?: string | undefined;
  }) => Effect.Effect<DocumentMeta, RepoError, Database.Runtime>;
  readonly get: (
    id: DocumentId,
  ) => Effect.Effect<Option.Option<DocumentMeta>, RepoError, Database.Runtime>;
  /** The stored CRDT snapshot, for cold-starting a room whose DO storage is empty. */
  readonly state: (
    id: DocumentId,
  ) => Effect.Effect<Option.Option<Uint8Array>, RepoError, Database.Runtime>;
  /** The room's debounced write: projection + snapshot, bumps `version`. */
  readonly saveProjection: (
    id: DocumentId,
    projection: Projection,
  ) => Effect.Effect<void, RepoError | DocumentNotFound, Database.Runtime>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@erudane/documents/DocumentRepo",
) {}

const fail = (message: string) => (cause: unknown) => new RepoError({ message, cause });

const toMeta = (row: typeof documents.$inferSelect): DocumentMeta =>
  new DocumentMeta({
    id: row.id as DocumentId,
    title: row.title,
    markdown: row.markdown,
    version: row.version,
    updatedBy: row.updatedBy,
    createdAt: DateTime.makeUnsafe(row.createdAt),
    updatedAt: DateTime.makeUnsafe(row.updatedAt),
  });

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service;

    const create: Interface["create"] = (document) =>
      Effect.gen(function* () {
        const inserted = yield* db
          .insert(documents)
          .values({ id: document.id, title: document.title ?? "" })
          .onConflictDoNothing()
          .returning();
        const row =
          inserted[0] ?? (yield* db.query.documents.findFirst({ where: { id: document.id } }));
        return toMeta(row!);
      }).pipe(Effect.mapError(fail("create document")));

    const get: Interface["get"] = (id) =>
      db.query.documents.findFirst({ where: { id } }).pipe(
        Effect.map((row) => Option.map(Option.fromUndefinedOr(row), toMeta)),
        Effect.mapError(fail("get document")),
      );

    const state: Interface["state"] = (id) =>
      db.query.documents.findFirst({ where: { id }, columns: { state: true } }).pipe(
        Effect.map((row) =>
          Option.map(Option.fromNullishOr(row?.state), (bytes) => new Uint8Array(bytes)),
        ),
        Effect.mapError(fail("read document state")),
      );

    const saveProjection: Interface["saveProjection"] = (id, projection) =>
      Effect.gen(function* () {
        const at = DateTime.formatIso(yield* DateTime.now);
        const rows = yield* db
          .update(documents)
          .set({
            markdown: projection.markdown,
            // drizzle types bytea as node Buffer; pg serializes any ArrayBufferView.
            state: projection.state as never,
            updatedBy: projection.updatedBy,
            version: sql`${documents.version} + 1`,
            updatedAt: at,
          })
          .where(eq(documents.id, id))
          .returning({ id: documents.id })
          .pipe(Effect.mapError(fail("save projection")));
        if (rows.length === 0) return yield* new DocumentNotFound({ documentId: id });
      });

    return Service.of({ create, get, state, saveProjection });
  }),
);

interface MemoryDocument {
  readonly meta: DocumentMeta;
  readonly state: Option.Option<Uint8Array>;
}

/** In-memory implementation for scratch scripts and tests. Requires nothing. */
export const memory = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* Ref.make(new Map<DocumentId, MemoryDocument>());

    const now = Effect.map(Clock.currentTimeMillis, (millis) => DateTime.makeUnsafe(millis));

    const create: Interface["create"] = (document) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(store);
        const existing = map.get(document.id);
        if (existing) return existing.meta;
        const at = yield* now;
        const meta = new DocumentMeta({
          id: document.id,
          title: document.title ?? "",
          markdown: "",
          version: 0,
          updatedBy: null,
          createdAt: at,
          updatedAt: at,
        });
        yield* Ref.set(store, new Map(map).set(document.id, { meta, state: Option.none() }));
        return meta;
      });

    const get: Interface["get"] = (id) =>
      Effect.map(Ref.get(store), (map) =>
        Option.map(Option.fromUndefinedOr(map.get(id)), (entry) => entry.meta),
      );

    const state: Interface["state"] = (id) =>
      Effect.map(Ref.get(store), (map) =>
        Option.flatMap(Option.fromUndefinedOr(map.get(id)), (entry) => entry.state),
      );

    const saveProjection: Interface["saveProjection"] = (id, projection) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(store);
        const entry = map.get(id);
        if (!entry) return yield* new DocumentNotFound({ documentId: id });
        const at = yield* now;
        const meta = new DocumentMeta({
          ...entry.meta,
          markdown: projection.markdown,
          updatedBy: projection.updatedBy,
          version: entry.meta.version + 1,
          updatedAt: at,
        });
        yield* Ref.set(store, new Map(map).set(id, { meta, state: Option.some(projection.state) }));
      });

    return Service.of({ create, get, state, saveProjection });
  }),
);

export * as DocumentRepo from "./repo";
