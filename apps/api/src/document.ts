import { HyperdriveDatabase } from "@erudane/db/hyperdrive";
import { Database } from "@erudane/db/service";
import { DocumentRepo } from "@erudane/documents/repo";
import * as Room from "@erudane/documents/room";
import { type DocumentActor, DocumentId, type RoomEdit } from "@erudane/documents/types";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

interface Attachment {
  /** Session id, also the y-protocols `origin` for frames from this socket. */
  readonly id: string;
  /** Awareness client ids this socket announced — removed when it leaves. */
  readonly clients: ReadonlyArray<number>;
}

const DEBOUNCE_MS = 5_000;

const asBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * One Durable Object per document: the authority on the Y.Doc, speaking the
 * y-websocket protocol to editors and applying agent ops via DO RPC. Content
 * persists in the DO's own SQLite as an update log, compacted into a single
 * snapshot row on a debounced alarm. The init below re-runs on every
 * activation — including hibernation wake — reloading the doc from storage
 * while accepted sockets survive.
 */
export default class DocumentRoom extends Cloudflare.DurableObject<DocumentRoom>()(
  "DocumentRoom",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const db = yield* Database.Service;
    const crypto = yield* Crypto.Crypto;
    const repo = Context.get(
      yield* Layer.build(
        DocumentRepo.layer.pipe(Layer.provide(Layer.succeed(Database.Service, db))),
      ),
      DocumentRepo.Service,
    );
    // @effect-diagnostics-next-line returnEffectInGen:off -- the DO contract: outer init resolves deps, returns the per-activation Effect
    return Effect.gen(function* () {
      /** The room name is the document id (`getByName(documentId)`); an unnamed room is a defect. */
      const documentId = DocumentId.make(state.id.name ?? "");
      const sql = state.storage.sql;
      /** Write statement: run to completion, discard the cursor. */
      const run = (query: string, ...bindings: ReadonlyArray<string | number | ArrayBuffer>) =>
        sql.exec(query, ...bindings).pipe(
          Effect.flatMap((cursor) => cursor.rowsWritten),
          Effect.asVoid,
        );
      yield* run(
        "CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)",
      );
      const stored = yield* (yield* sql.exec<{ data: ArrayBuffer }>(
        "SELECT data FROM updates ORDER BY seq",
      )).toArray();
      // Empty DO storage = brand-new room (or storage lost): seed from the
      // Postgres snapshot, so the projection doubles as the backup.
      const seed =
        stored.length > 0
          ? Option.none<Uint8Array>()
          : yield* repo
              .state(documentId)
              .pipe(Effect.catchTag("Documents.RepoError", () => Effect.succeed(Option.none())));
      const room = Room.open({
        snapshot: Option.getOrUndefined(seed),
        updates: stored.map((row) => new Uint8Array(row.data)),
      });
      /** Attribution for the projection write: who wrote since the last save. */
      let lastActor: DocumentActor = "user";

      // Sessions survive hibernation on the runtime side; rebuild our map.
      const sessions = new Map<string, Cloudflare.WebSocket>();
      for (const socket of yield* state.getWebSockets()) {
        const attachment = socket.deserializeAttachment<Attachment>();
        if (attachment) sessions.set(attachment.id, socket);
      }

      /** Doc updates waiting for the SQLite log; flushed after each handler. */
      const pending: Uint8Array[] = [];
      Room.subscribe(room, {
        broadcast: (frame) => {
          for (const peer of sessions.values()) peer.ws.send(frame);
        },
        update: (update) => pending.push(update),
        awareness: (change, origin) => {
          if (typeof origin !== "string") return;
          const socket = sessions.get(origin);
          if (!socket) return;
          const attachment = socket.deserializeAttachment<Attachment>() ?? {
            id: origin,
            clients: [],
          };
          const clients = new Set(attachment.clients);
          for (const client of change.added) clients.add(client);
          for (const client of change.updated) clients.add(client);
          for (const client of change.removed) clients.delete(client);
          socket.serializeAttachment({ ...attachment, clients: [...clients] });
        },
      });

      const flush = Effect.gen(function* () {
        if (pending.length === 0) return;
        for (const update of pending.splice(0)) {
          yield* run("INSERT INTO updates (data) VALUES (?)", asBuffer(update));
        }
        const alarm = yield* state.storage.getAlarm();
        if (alarm === null) {
          const now = yield* Clock.currentTimeMillis;
          yield* state.storage.setAlarm(now + DEBOUNCE_MS);
        }
      });

      return {
        fetch: Effect.gen(function* () {
          const [response, socket] = yield* Cloudflare.upgrade();
          const id = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
          socket.serializeAttachment({ id, clients: [] } satisfies Attachment);
          sessions.set(id, socket);
          for (const frame of Room.greeting(room)) yield* socket.send(frame);
          return response;
        }),

        webSocketMessage: Effect.fn(function* (
          socket: Cloudflare.WebSocket,
          message: string | ArrayBuffer,
        ) {
          if (typeof message === "string") return;
          const attachment = socket.deserializeAttachment<Attachment>();
          if (!attachment) return;
          sessions.set(attachment.id, socket);
          for (const reply of Room.receive(room, new Uint8Array(message), attachment.id)) {
            yield* socket.send(reply);
          }
          if (pending.length > 0) lastActor = "user";
          yield* flush;
        }),

        webSocketClose: Effect.fn(function* (
          socket: Cloudflare.WebSocket,
          code: number,
          reason: string,
          _wasClean: boolean,
        ) {
          const attachment = socket.deserializeAttachment<Attachment>();
          if (attachment) {
            sessions.delete(attachment.id);
            Room.disconnect(room, attachment.clients);
          }
          yield* socket.close(code, reason);
        }),

        /**
         * Debounced save: compact the log into one snapshot row, then write
         * the Postgres projection (markdown + snapshot + actor). A missing
         * row only skips the projection — DO SQLite still has the content.
         */
        alarm: () =>
          Effect.gen(function* () {
            yield* flush;
            const snapshot = Room.encodeState(room);
            yield* run("DELETE FROM updates");
            yield* run("INSERT INTO updates (data) VALUES (?)", asBuffer(snapshot));
            yield* repo
              .saveProjection(documentId, {
                markdown: Room.markdown(room),
                state: snapshot,
                updatedBy: lastActor,
              })
              .pipe(
                Effect.catchTags({
                  "Documents.DocumentNotFound": () =>
                    Effect.logDebug("no document row; projection skipped"),
                  "Documents.RepoError": (error) => Effect.logError("projection failed", error),
                }),
              );
          }),

        /** Agent write path (RoomClient RPC): ops land live on every editor. */
        edit: (ops: ReadonlyArray<RoomEdit>) =>
          Effect.gen(function* () {
            lastActor = "agent";
            Room.agentPresence(room, true);
            Room.edit(room, ops);
            Room.agentPresence(room, false);
            yield* flush;
          }),

        /** Agent read path: markdown annotated with block ids. */
        read: () => Effect.sync(() => Room.annotatedMarkdown(room)),
      };
    });
  }).pipe(Effect.provide([HyperdriveDatabase.layer, BrowserCrypto.layer])),
) {}
