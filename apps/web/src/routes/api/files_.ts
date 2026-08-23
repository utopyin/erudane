import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

/** Same-origin proxy to the API worker's file upload route. */
export const Route = createFileRoute("/api/files_")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = "/files";
        return env.API.fetch(new Request(url, request));
      },
    },
  },
});
