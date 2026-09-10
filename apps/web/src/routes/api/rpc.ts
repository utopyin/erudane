import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

/** Same-origin proxy to the API worker's `/rpc` over the service binding. */
export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = "/rpc";
        return env.API.fetch(new Request(url, request));
      },
    },
  },
});
