# Packages

Two packages are added. Existing packages change only where they own a boundary or use case.

```text
packages/storage      @erudane/storage   tier 1  object-store mechanism
packages/db           @erudane/db        tier 1  + files table shape
packages/ui           @erudane/ui        tier 1  + attachment presentation

domains/files         @erudane/files     tier 2  file identity, validation, metadata and bytes
domains/chat          @erudane/chat      tier 2  Run depends on files to resolve references

entrypoints/http      @erudane/http       tier 3  file routes and TanStack media codec

apps/api              @erudane/api        tier 4  layer assembly and R2 binding
apps/web              @erudane/web        tier 4  upload state, proxy and sendMessage parts
```

Dependency direction:

```text
apps/api ─┬─> entrypoints/http ─┬─> domains/chat ─> domains/files ─┬─> packages/storage
          │                     └─> domains/files                  └─> packages/db
          └─> packages/storage

apps/web ─> packages/ui
```

There is no files-to-chat edge.

## New files

```text
packages/storage/
  package.json
  tsconfig.json
  file-store.ts       provider-neutral service, errors and memory layer
  r2.ts               R2 implementation and bucket resource

domains/files/
  package.json
  tsconfig.json
  types.ts            FileId, File, upload input and reference helpers
  errors.ts           validation, not-found and persistence errors
  service.ts          Files.Service and Database + FileStore layer
entrypoints/http/files/
  route.ts            POST /files and GET /files/:id
packages/ui/src/ai/
  attachment.tsx      shared tile
apps/web/src/routes/api/
  files.ts            same-origin upload proxy
  files.$.ts          same-origin download proxy
```

## Changed exports

- `@erudane/storage/file-store` and `@erudane/storage/r2` are focused subpaths. There is no root barrel.
- `@erudane/files/types`, `@erudane/files/errors` and `@erudane/files/service` are focused subpaths.
- `@erudane/ui/ai/attachment` is covered by the UI package's existing wildcard export.
- `@erudane/http` remains the router root. Its package manifest adds dependencies on files and storage only where route requirements demand them.

## Closure checks

- `@erudane/storage/file-store` imports Effect plus Alchemy's request-runtime type. It imports no R2 API or Cloudflare object shape.
- `@erudane/storage/r2` imports the file-store module and Alchemy Cloudflare R2.
- `@erudane/files/types` imports Effect schemas only.
- `@erudane/files/service` imports DB schema/service and `FileStore`; it does not import HTTP, chat or R2.
- `@erudane/chat/run` imports `Files.Service`; no other chat module needs storage or HTTP knowledge.
