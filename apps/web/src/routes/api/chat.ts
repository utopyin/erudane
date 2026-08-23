import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

/** Same-origin proxy to the API worker's `/chat` over the service binding. */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = "/chat";
        return env.API.fetch(new Request(url, request));
      },
    },
  },
});
