import { createFileRoute, redirect } from "@tanstack/react-router";

/** A new chat is a fresh id; the thread row is created by its first run. */
export const Route = createFileRoute("/chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/chat/$threadId", params: { threadId: crypto.randomUUID() } });
  },
});
