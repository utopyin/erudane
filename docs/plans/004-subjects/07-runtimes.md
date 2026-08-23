# Runtimes & infra

No new alchemy *resources*: the Durable Object rides inside the existing `Api` worker (alchemy emits the binding and the `new_classes` migration itself), Postgres and Hyperdrive are 002's, and the one schema migration flows through the existing `db:generate`/deploy pipeline (D19).

## `apps/api` — the worker init grows

```ts
export default class Api extends Cloudflare.Worker<Api, {}, DocumentRoom>()(   // 3rd type arg hosts the DO
  "Api",
  { main: import.meta.url, compatibility: { flags: ["nodejs_compat"] } },
  Effect.gen(function* () {
    const db = yield* Database.Service;
    const rooms = yield* DocumentRoom;                 // DO namespace binding (hosted here)

    const services = yield* Layer.build(
      Layer.mergeAll(Run.layer, RpcHandlers /* via Http */, SubjectHandlers).pipe(
        Layer.provideMerge(Layer.mergeAll(
          Chat.layer, ThreadRepo.layer,
          SubjectRepo.layer, Subjects.layer, ExerciseRuns.layer,
          DocumentRepo.layer, Documents.layer,
        )),
        Layer.provide(Layer.mergeAll(Model.layer, registry, RoomClient.fromNamespace(rooms))),
        Layer.provideMerge(Layer.succeed(Database.Service, db)),
      ),
    );
    const handler = yield* HttpRouter.toHttpEffect(Http.layer);
    return { fetch: handler.pipe(Effect.provideContext(services)) };
  }).pipe(Effect.provide(Database.layer)),
) {}
```

- `RoomClient.fromNamespace(rooms)`: the tier-4 implementation of the documents domain's `RoomClient` contract — `getByName(documentId)` → DO RPC (`edit`, `snapshot`). The domain never sees `cloudflare:workers`.
- `src/document.ts` declares `DocumentRoom` (Effect-form DO, 05): `fetch` answers the upgrade via `Cloudflare.upgrade()`; `webSocketMessage` runs `room.ts`'s y-protocols handling; `alarm` runs the debounced save (DO SQLite compaction + Postgres projection via the same Hyperdrive binding — the DO shares the worker's env); RPC methods `edit`/`snapshot` serve the RoomClient. Init reload-on-activation is the hibernation-wake path.
- The `/documents/:id/ws` route (tier 3) forwards the upgrade request to the DO stub's fetch; the stub comes from the same binding, provided to the router layer as a small service alongside `RoomClient`.

## `apps/web`

- The browser needs the API worker's **public URL** for the WebSocket (the service binding only serves server-side fetches). Wire it through the Website env: `env: { API: Api, API_URL: api.url }` in `alchemy.run.ts` — a plain text var next to the existing binding — read by `src/env.ts`, handed to `WebsocketProvider` as `wss://…/documents/:id/ws`. In `alchemy dev` it's the localhost worker URL (dev-registry proxies pass 101 upgrades through — verified `WorkerProxy.test.ts:42-57`).
- `/api/rpc` proxy route (same shape as `/api/chat`); `/api/threads` deleted.
- Origin checks on the upgrade endpoint: deferred to 004 with the rest of auth (same posture as D21 — documents are readable by whoever knows the UUID until then, stated not hidden). WebSockets aren't CORS-governed; there is nothing to configure to make it *work*, only to *restrict* it.

## `alchemy.run.ts`

Only the `API_URL` env addition above. `Alchemy.retain` posture, Hyperdrive, Docker dev database, migration Exec: unchanged from 002.

## Dev loop

`bun run dev` as today: Docker Postgres + migrations + both workers. The DO runs in local workerd with real SQLite storage and hibernatable sockets; two browser tabs on one lesson is the local collab test. `ThreadRepo.memory`-style scratch verification extends to `SubjectRepo.memory`/`DocumentRepo.memory`; `room.ts` is plain functions over `Y.Doc`, testable in a bun script with no DO at all — that's the point of keeping it transport-neutral.
