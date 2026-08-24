# Infrastructure

## Private R2 bucket

`packages/storage/r2.ts` declares the resource and its service layer:

```ts
export const Bucket = Cloudflare.R2.Bucket("Files");
```

No public development URL or custom domain is configured. The bucket is retained on stack destruction because uploaded files outlive one deploy. Production deletion requires an explicit retention-policy change and a separate migration or backup decision.

The layer obtains `Cloudflare.R2.ReadWriteBucket(Bucket)` and wraps it as `FileStore.Service`. It is provided with `Cloudflare.R2.ReadWriteBucketBinding`, following the Effect-form worker examples in vendored Alchemy.

Alchemy supplies the local R2 implementation during `alchemy dev`. Domain-only checks use `FileStore.memory` and do not require an Alchemy runtime.

## API worker composition

The worker init builds these services once per isolate:

```text
Database.Service
FileStore.Service (R2 binding)
Files.Service     (Database + FileStore)
ThreadRepo.Service
Chat.Service
Run.Service       (Chat + ThreadRepo + Files)
HTTP routes       (Run + ThreadRepo + Files)
```

`FileStore` and `Files` must remain visible in the built context because HTTP file routes call `Files` while `Run` also consumes it. The R2 binding layer is supplied at the worker init boundary, not inside the domain.

The worker keeps `nodejs_compat` for Postgres. R2 needs no public environment value or secret.

## Stack outputs

`alchemy.run.ts` yields `Bucket` so Alchemy registers it even if layer composition changes. Stack outputs include the bucket name alongside the existing API, website and Hyperdrive outputs. The resource is retained, so `alchemy destroy` leaves it in place.

## Local verification

`bun run dev` should create or reuse local R2 state. Upload an image, fetch it through `/api/files/<id>`, restart Alchemy, and fetch the same id again. The metadata row and local bucket object must both survive the restart.
