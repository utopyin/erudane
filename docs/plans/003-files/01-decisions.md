# Decisions

Numbering continues from persistence D22.

## D23 — TanStack AI media parts are the chat wire

The web app calls `sendMessage` with a `content` array containing a text part and zero or more image/document parts:

```ts
{
  content: [
    { type: "text", content: text },
    {
      type: "image", // or "document"
      source: { type: "url", value: `/api/files/${id}` },
      metadata: { fileId: id, fileName, size },
    },
  ],
}
```

TanStack AI has no separate attachment protocol. `collectUserContent` serializes these parts into the AG-UI user message content. The HTTP codec validates that shape and reads `metadata.fileId`; it never fetches the client-provided URL.

## D24 — Upload through the API worker, with a 20 MB cap

`POST /files` takes the raw body. `content-type` declares the media type and `x-file-name` carries the original display name. The response is `{ id, mediaType, fileName, size }`.

The files domain accepts PDFs and raster images whose declared MIME agrees with their signature. V1 recognizes PDF, JPEG, PNG, GIF and WebP. It rejects empty files, mismatched signatures, other media types and files larger than 20 MiB. SVG is excluded because it is active text content, not a magic-signature raster format.

The client uploads immediately after pick, paste or drop. It does not use presigned URLs. This keeps validation, ownership and storage policy behind one API boundary.

## D25 — Object storage is a tier-1 service, not an R2-shaped domain API

`@erudane/storage/file-store` declares `FileStore.Service` with `put`, `get`, `head` and `delete` by opaque key. Its values use `Uint8Array`, Effect `Stream` and plain metadata. No domain imports Cloudflare types.

The package provides an R2 layer and an in-memory layer. Alchemy's R2 binding supplies local object storage during `alchemy dev`, so a separate filesystem adapter would be unused and is not added in this slice.

## D26 — Stored chat messages contain stable private references

A file part is stored as Effect AI's existing `Prompt.FilePart`:

```ts
Prompt.filePart({
  mediaType,
  fileName,
  data: new URL(`erudane://files/${id}`),
});
```

The message table and `Prompt.Message` codec already support this shape. No message migration is needed. Stored messages never contain uploaded bytes, base64 data or a public R2 URL.

## D27 — `Run` resolves references immediately before model inference

`Chat.stream` remains a model loop over `Prompt.Message[]`. `Run.start` loads history, asks `Files.Service` to resolve every `erudane://files/<id>` part, replaces its data with `Uint8Array`, then calls `Chat.stream`.

Resolution covers both the new user message and historical messages. Unknown URL schemes pass through unchanged so Effect AI can still support ordinary provider-readable URLs. Missing private files fail the run before inference.

This is also the seam for a later provider file cache. OpenAI `file_id` values can replace bytes without changing stored chat messages.

## D28 — File metadata lives in `eru_files`; bytes remain in the store

`eru_files` contains `id`, opaque `key`, `mediaType`, optional `fileName`, `size` and `createdAt`. `Files.Service` owns metadata and storage coordination.

Upload writes the object first, then inserts metadata. If the insert fails, it attempts a compensating object delete. A worker crash between those writes can leave an unindexed object, which the deferred cleanup job may remove. Writing metadata first would expose a file that cannot be read, so object-first is the safer failure mode.

## D29 — The bucket is private and files are served by the API

`GET /files/:id` looks up metadata and streams the object with its stored content type, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, an ETag when available, and private cache headers. The R2 bucket has no public domain.

The web route `/api/files/$` forwards both upload and download requests to the API worker.

## D30 — One attachment tile renders pending and stored files

`@erudane/ui/ai/attachment` owns the square tile. Images show a cropped preview. PDFs show a filled document icon, truncated filename and formatted size. The composer adds upload progress/error/removal controls; thread messages use the same tile without upload controls.

Send is disabled while any upload is pending or failed. A message may contain attachments with empty text. On successful send the composer revokes object URLs and clears its attachment state.

## D31 — Deferred work has named seams

- Ownership and authorization add `ownerId` to file metadata and guards to the two file routes.
- Orphan cleanup scans old `eru_files` rows and message references, then deletes unreferenced rows and objects.
- Provider upload caches map a file id plus provider to a provider file id.
- Text-like documents can become text parts after extraction; Office formats need a separate extraction pipeline.
- Multiple-file aggregate limits and image resizing can be added if real usage shows a need. V1 limits each file to 20 MiB.
