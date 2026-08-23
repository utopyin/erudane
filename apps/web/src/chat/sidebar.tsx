import { Link } from "@tanstack/react-router";
import { Button } from "@erudane/ui/button";
import { ChatIcon, ComposeIcon } from "@erudane/ui/icons";
import { cn } from "@erudane/ui/utils";
import type { ThreadSummary } from "./threads";

const label = (thread: ThreadSummary) =>
  thread.title ??
  `Chat · ${new Date(thread.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

export function Sidebar({
  threads,
  current,
}: {
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly current?: string | undefined;
}) {
  return (
    <aside className="bg-muted/40 flex w-64 shrink-0 flex-col gap-2 border-r p-3">
      <Button
        variant="outline"
        className="justify-start gap-2"
        render={<Link to="/chat" reloadDocument={false} />}
      >
        <ComposeIcon />
        New chat
      </Button>
      <nav className="flex flex-col gap-0.5 overflow-y-auto">
        {threads.map((thread) => (
          <Link
            key={thread.id}
            to="/chat/$threadId"
            params={{ threadId: thread.id }}
            className={cn(
              "hover:bg-muted flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm",
              thread.id === current && "bg-muted font-medium",
            )}
          >
            <ChatIcon className="text-muted-foreground shrink-0" />
            <span className="truncate">{label(thread)}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
