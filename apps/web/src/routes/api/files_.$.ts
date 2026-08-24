import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

/** Same-origin wildcard proxy to the API worker's private file routes. */
export const Route = createFileRoute("/api/files_/$")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(/^\/api/, "");
        return env.API.fetch(new Request(url, request));
      },
    },
  },
});
