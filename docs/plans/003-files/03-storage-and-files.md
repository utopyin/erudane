# Storage and files domain

## `FileStore`

The tier-1 interface describes opaque-key object storage:

```ts
export interface Interface {
  readonly put: (input: {
    readonly key: string;
    readonly data: Uint8Array;
    readonly mediaType: string;
  }) => Effect.Effect<ObjectMetadata, StoreError>;
  readonly get: (key: string) => Effect.Effect<Option.Option<StoredObject>, StoreError>;
  readonly head: (key: string) => Effect.Effect<Option.Option<ObjectMetadata>, StoreError>;
  readonly delete: (key: string) => Effect.Effect<void, StoreError>;
}
```

`StoredObject` contains metadata plus `body: Stream.Stream<Uint8Array, StoreError>`. Metadata contains `size`, optional `mediaType` and optional `etag`. The service does not expose `R2Object`, bucket names, bindings or HTTP responses.

The R2 layer wraps `Cloudflare.R2.ReadWriteBucket(Bucket)`. Its own methods map `R2Error` to `StoreError`. `get` passes the object's body stream through while normalizing metadata. `put` records `httpMetadata.contentType`.

The memory layer keeps copied byte arrays in a `Ref<HashMap<string, ...>>`. Reads return another copy so callers cannot mutate stored data.

## Database schema

`packages/db/schema.ts` adds:

```ts
export const files = table("files", {
  id: uuid().primaryKey(),
  key: text().notNull().unique(),
  mediaType: text().notNull(),
  fileName: text(),
  size: integer().notNull(),
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
```

The migration is generated with `bun run db:generate`. There is no owner or message join table in v1. `Prompt.Message` carries the reference.

## Domain model

`FileId` is a UUID brand. `File` carries id, media type, optional display name, byte size and creation time. The storage key is deliberately absent from the public model.

References use one canonical form:

```text
erudane://files/<uuid>
```

`reference(id)` constructs it. `fromReference(url)` returns an optional `FileId`; it checks protocol, host, one path segment and UUID syntax.

## Validation

`Files.upload` receives bytes, a declared media type and optional filename. It:

1. Rejects zero bytes and more than 20 MiB.
2. Normalizes the MIME value by discarding parameters and lowercasing it.
3. Detects PDF, JPEG, PNG, GIF or WebP from leading bytes.
4. Requires the declared and detected types to agree.
5. Sanitizes the display filename by taking the final path segment, removing control characters and limiting its length. The original name never becomes an object key or response header verbatim.
6. Mints a file UUID and an opaque object key such as `files/<uuid>`.
7. Writes bytes to `FileStore`, then inserts the metadata row.
8. Attempts `FileStore.delete` if the database insert fails.

`get(id)` returns metadata or `FileNotFound`. `resolve(id)` loads metadata and the matching stored object. Missing object bytes are a storage consistency error, not a 404, because the metadata row says the file exists.

The service maps Drizzle and store failures into typed domain errors. Transport code maps validation errors to 400/413/415, missing files to 404 and storage failures to 500.
