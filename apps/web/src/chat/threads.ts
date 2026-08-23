import { createServerFn } from "@tanstack/react-start";
import { env } from "@/env";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The sidebar's list, newest activity first. Runs on the server, over the service binding. */
export const listThreads = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReadonlyArray<ThreadSummary>> => {
    const response = await env.API.fetch(new Request("https://api/threads?limit=50"));
    if (!response.ok) throw new Error(`threads: ${response.status}`);
    const body = (await response.json()) as { threads: ReadonlyArray<ThreadSummary> };
    return body.threads;
  },
);
