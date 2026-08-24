# Phases

Each phase ends with `bun run check:types`. Formatting runs after the slice is complete so intermediate edits stay readable.

## Phase 0 — Plan and package shells

- Commit this plan after review.
- Add `packages/storage` and `domains/files` manifests and TypeScript configs.
- Add package dependencies without changing runtime wiring.

Verify workspace resolution and package type checks.

## Phase 1 — Storage, schema and files domain

- Implement provider-neutral `FileStore` plus memory and R2 layers.
- Add `eru_files` and generate the migration.
- Implement file ids/references, magic validation and `Files.Service`.
- Add the private retained bucket resource.

Verify with a scratch Effect using memory storage: valid PNG/PDF upload and resolve round-trip; unsupported, mismatched, empty and oversized files fail with their typed errors. Run `bun run db:generate`, inspect the SQL, and apply it through local development before HTTP checks.

## Phase 2 — File HTTP routes and worker wiring

- Add `POST /files` and `GET /files/:id`.
- Merge routes into `Http.layer`.
- Build `FileStore` and `Files` in the API worker.
- Add the web wildcard proxy.
- Add bucket stack output.

Verify with `curl`: upload a small PNG and PDF, inspect JSON, download byte-for-byte, check content/cache headers, and confirm 400/404/413/415 mappings.

## Phase 3 — Chat references and model resolution

- Extend AG-UI inbound media schemas and produce stored `Prompt.filePart` references.
- Make hydration file-aware.
- Resolve references in `Run` before `Chat.stream`.
- Keep `Chat.Service` unchanged.

Verify a file-only user message persists a URL reference, hydration returns `/api/files/<id>`, and the model receives `Uint8Array`. Reload and send a follow-up so historical attachment resolution is exercised. Verify image inference on both model paths; verify PDF on the API-key path and record the result of the ChatGPT development path.

## Phase 4 — Composer and thread UI

- Add the shared attachment tile.
- Add picker, paste and drop ingestion to `PromptInput`.
- Implement immediate upload, cancellation, cleanup and submit gating.
- Send TanStack content arrays from the web chat.
- Render image/document parts in messages.

Browser verification is manual: select, paste and drop; image/PDF previews; remove while uploading; failed upload; attachment-only send; send while upload is pending; reload; same thread in another browser; mobile wrapping and keyboard submit.

## Phase 5 — Final checks

- Run `bun run fix` and `bun run check:types`.
- Inspect generated migration and package dependency direction.
- Review the diff for leaked R2 types, public bucket URLs, base64 in persisted messages and object URL leaks.
- Deploy only after local browser review.

## Deferred

Ownership, orphan cleanup, provider file caches, extraction for other document types, image resizing and partial-run persistence remain separate work.
