import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { Sidebar } from "@/chat/sidebar";
import { listThreads } from "@/chat/threads";

/** Layout: the thread list beside whichever chat is open. */
export const Route = createFileRoute("/chat")({
  loader: () => listThreads(),
  component: ChatLayout,
});

function ChatLayout() {
  const threads = Route.useLoaderData();
  const params = useParams({ strict: false });
  return (
    <div className="flex h-dvh">
      <Sidebar threads={threads} current={params.threadId} />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
