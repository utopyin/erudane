# Chat and HTTP

## Inbound AG-UI content

`entrypoints/http/chat/agui.ts` extends user content to:

```ts
type WireContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image" | "document";
          source: { type: "url"; value: string };
          metadata: { fileId: string; fileName?: string; size: number };
        }
    >;
```

TanStack renames the client text field from `content` to `text` on the AG-UI wire. Media parts retain `source` and `metadata`.

`toUserMessage` validates each file id through `Files.Service.get`. It also requires:

- `image` for a stored `image/*` media type;
- `document` for `application/pdf`;
- `source.type === "url"` and `source.value === "/api/files/<fileId>"`.

The server uses stored media type, filename and size. Client metadata is only checked for wire consistency. The resulting `Prompt.filePart` contains `erudane://files/<id>`.

A user message must contain text or at least one attachment. Empty text parts are omitted.

## Stored-to-UI hydration

`entrypoints/http/chat/ui.ts` maps stored file parts back to TanStack parts:

```ts
{
  type: mediaType.startsWith("image/") ? "image" : "document",
  source: { type: "url", value: `/api/files/${id}` },
  metadata: { fileId: id, fileName, size },
}
```

The codec resolves file metadata through `Files.Service`, so `toUiMessages` becomes effectful. Invalid non-Erudane URLs are preserved as ordinary URL media parts when their media type is supported. A missing private file fails hydration as storage inconsistency rather than silently dropping the tile.

## Model resolution in `Run`

Before `chat.stream`, `Run` walks all user messages in loaded history plus the new message. For each `Prompt.FilePart` whose data is an Erudane file reference, it:

1. Parses the file id.
2. Calls `Files.resolve`.
3. Collects the object stream into a `Uint8Array` with the same 20 MiB bound.
4. Rebuilds the part from authoritative metadata and bytes.

It resolves files once per run even if a reference appears more than once. The stored input remains unchanged. `Chat.Service` does not gain a files dependency.

## File routes

| Method | Path         | Input                                    | Response                                |
| ------ | ------------ | ---------------------------------------- | --------------------------------------- |
| POST   | `/files`     | raw bytes, `content-type`, `x-file-name` | `201 { id, mediaType, fileName, size }` |
| GET    | `/files/:id` | UUID path parameter                      | streamed bytes                          |

The upload handler checks `content-length` early when present, then folds the request stream with the same byte limit. Domain validation remains authoritative because clients may omit or forge the header.

The download handler uses the stored metadata and object stream. It emits `content-type`, `content-disposition`, `x-content-type-options: nosniff`, an ETag when available and `cache-control: private, max-age=31536000, immutable`. File ids are immutable; replacing bytes under an id is not supported.

`apps/web/src/routes/api/files.ts` forwards uploads and `files.$.ts` forwards the download wildcard. Both keep the API worker origin private.
