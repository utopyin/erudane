import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "@/chat/chat";

export const Route = createFileRoute("/chat/$threadId")({ component: ThreadPage });

function ThreadPage() {
  const { threadId } = Route.useParams();
  return <Chat key={threadId} threadId={threadId} />;
}
