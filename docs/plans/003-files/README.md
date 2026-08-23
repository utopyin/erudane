# 003 — File attachments

Users can attach images and PDFs to a chat message. The browser uploads each file before send, shows attachment tiles in the composer and thread, and sends TanStack AI media parts alongside text. The server stores bytes in a private object store, stores stable file references in `Prompt.Message`, and resolves those references only when a model run needs bytes.

This plan adds a provider-neutral storage package and a files domain. Chat depends on files in one direction. HTTP remains the only package that knows the TanStack media-part wire format.

Read in order:

| Doc                                                  | What it fixes                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| [01-decisions.md](./01-decisions.md)                 | Decisions D23–D31                                                      |
| [02-packages.md](./02-packages.md)                   | Tier placement, files, exports and dependency direction                |
| [03-storage-and-files.md](./03-storage-and-files.md) | `FileStore`, `eru_files`, validation and reference resolution          |
| [04-chat-and-http.md](./04-chat-and-http.md)         | AG-UI media parts, stored references, model resolution and file routes |
| [05-web-and-ui.md](./05-web-and-ui.md)               | Upload state, picker/paste/drop and shared attachment tiles            |
| [06-infra.md](./06-infra.md)                         | Private R2 resource, binding and API worker composition                |
| [07-phases.md](./07-phases.md)                       | Implementation order and verification                                  |

Related: [002-persistence](../002-persistence/README.md), [package architecture](../../architecture/CONTEXT.md).

## The path of one attachment

```text
browser File
  │ POST /api/files  raw bytes + content-type + x-file-name
  ▼
apps/web proxy → entrypoints/http → domains/files → packages/storage → private R2
                                      │
                                      └─ eru_files metadata row

sendMessage({ content: [text part, image/document URL part] })
  ▼
TanStack AG-UI wire → HTTP codec → Prompt.filePart(erudane://files/<id>)
  ▼
ThreadRepo stores the reference unchanged
  ▼
Run resolves reference → Uint8Array → Effect AI model adapter

GET /api/files/<id> ← hydration/thread tile URL ← private store stream
```

## Known gaps

- Until authentication lands, anyone who knows a file UUID can read it. This matches the current thread policy.
- Uploads that are never attached to a sent message remain orphaned. A later cleanup job will delete old unreferenced rows and objects.
- A run holds each unique referenced file in memory for the provider call. V1 has a 20 MiB per-file cap but no aggregate run cap yet.
- The ChatGPT subscription backend accepts images. PDF support on that development-only path still needs live verification. The OpenAI API-key path supports images and PDFs.
- Text, markdown, CSV, Office documents and archives are out of v1.
