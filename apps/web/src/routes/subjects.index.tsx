import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@erudane/ui/badge";
import { Button } from "@erudane/ui/button";
import { BrainIcon, ChatIcon } from "@erudane/ui/icons";
import * as DateTime from "effect/DateTime";
import { rpc } from "@/rpc";

export const Route = createFileRoute("/subjects/")({
  ssr: false,
  loader: () => rpc((api) => api["subjects.list"]()),
  component: SubjectsPage,
});

function SubjectsPage() {
  const subjects = Route.useLoaderData();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Subjects</h1>
        <Button variant="outline" render={<Link to="/chat" />}>
          <ChatIcon />
          New chat
        </Button>
      </header>
      {subjects.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing yet. Tell the chat what you want to learn — it will set the subject up for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <Link
                to="/subjects/$subjectId"
                params={{ subjectId: subject.id }}
                className="hover:bg-muted flex items-center gap-3 rounded-lg border p-4"
              >
                <BrainIcon className="text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{subject.title}</div>
                  {subject.about.length > 0 && (
                    <div className="text-muted-foreground truncate text-sm">{subject.about}</div>
                  )}
                </div>
                {subject.dueAt !== null && (
                  <Badge variant="outline">due {DateTime.formatIsoDate(subject.dueAt)}</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
