/**
 * The typed API client: one RPC surface for everything that is not a chat run
 * or the collab socket. Domain errors decode back to tagged instances, so UI
 * code branches on `_tag` exactly like the server does; `RpcClientError` is
 * the "network broke" bucket.
 *
 * Browser-safe module — the server-side (SSR/server-fn) variant that rides the
 * service binding lives with the callers that need it (`serverLayer` consumers
 * pass their own fetch).
 */
import { ThreadRpcs } from "@erudane/chat/rpc";
import { SubjectRpcs } from "@erudane/subjects/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";

export const group = ThreadRpcs.merge(SubjectRpcs);

export interface ClientOptions {
  /** Absolute URL of the rpc endpoint (the protocol needs one). */
  readonly url: string;
  /** Override transport, e.g. the service binding's fetch on the server. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

const client = (options: ClientOptions) =>
  Layer.effect(Api)(RpcClient.make(group)).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url: options.url }).pipe(
        Layer.provide([
          RpcSerialization.layerNdjson,
          options.fetch === undefined
            ? FetchHttpClient.layer
            : FetchHttpClient.layer.pipe(
                Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
              ),
        ]),
      ),
    ),
  );

export class Api extends Context.Service<
  Api,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof group>, RpcClientError>
>()("@erudane/web/Api") {
  /** Browser: same-origin `/api/rpc` through the TanStack proxy route. */
  static readonly layer = Layer.unwrap(
    Effect.sync(() => client({ url: new URL("/api/rpc", globalThis.location.origin).toString() })),
  );
  /** Custom endpoint/transport (SSR loaders, server fns over the service binding). */
  static readonly layerWith = client;
}

const runtime = ManagedRuntime.make(Api.layer);

/** Run one API call from UI code: `rpc((api) => api["subjects.outline"]({ id }))`. */
export const rpc = <A, E>(f: (api: Api["Service"]) => Effect.Effect<A, E>): Promise<A> =>
  runtime.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* Api);
    }),
  );
