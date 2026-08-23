import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

/** Same-origin proxy to the API worker's `/info` (its public URL, for the document WebSocket). */
export const Route = createFileRoute("/api/info")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = "/info";
        return env.API.fetch(new Request(url, request));
      },
    },
  },
});
