/**
 * The chat domain's request/response contract, served over Effect RPC.
 *
 * LEAF MODULE: imports only `./types`, `./errors`, and `effect` — the web app
 * imports this group for `RpcClient.make` without pulling repositories in.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { RepoError } from "./errors";
import { Thread } from "./types";

export const ThreadRpcs = RpcGroup.make(
  Rpc.make("threads.list", {
    payload: { limit: Schema.optionalKey(Schema.Int) },
    success: Schema.Array(Thread),
    error: RepoError,
  }),
  Rpc.make("threads.create", {
    payload: { title: Schema.optionalKey(Schema.String) },
    success: Thread,
    error: RepoError,
  }),
);

export * as ChatRpcs from "./rpc";
