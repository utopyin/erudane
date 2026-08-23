import { createServerFn } from "@tanstack/react-start";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { env } from "@/env";
import { Api } from "@/rpc";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** RPC over the service binding: same wire as the browser, server transport. */
const bindingFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  env.API.fetch(
    new Request(input, init),
  ) as unknown as Promise<Response>) as typeof globalThis.fetch;

const runtime = ManagedRuntime.make(Api.layerWith({ url: "https://api/rpc", fetch: bindingFetch }));

/** The sidebar's list, newest activity first. Runs on the server, over the service binding. */
export const listThreads = createServerFn({ method: "GET" }).handler(
  (): Promise<ReadonlyArray<ThreadSummary>> =>
    runtime.runPromise(
      Effect.gen(function* () {
        const api = yield* Api;
        const threads = yield* api["threads.list"]({ limit: 50 });
        return threads.map((thread) => ({
          id: thread.id,
          title: thread.title,
          createdAt: DateTime.formatIso(thread.createdAt),
          updatedAt: DateTime.formatIso(thread.updatedAt),
        }));
      }),
    ),
);
