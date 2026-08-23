import type { SubjectId } from "@erudane/subjects/types";
import { Badge } from "@erudane/ui/badge";
import { Button } from "@erudane/ui/button";
import { ChatIcon, PageIcon, SparkleIcon } from "@erudane/ui/icons";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import { useState } from "react";
import { rpc } from "@/rpc";

export const Route = createFileRoute("/subjects/$subjectId")({
  ssr: false,
  loader: ({ params }) =>
    Promise.all([
      rpc((api) => api["subjects.outline"]({ id: params.subjectId as SubjectId })),
      rpc((api) => api["subjects.threads"]({ id: params.subjectId as SubjectId })),
    ]),
  component: SubjectPage,
});

const STATUS_LABEL = {
  not_started: "not started",
  in_progress: "in progress",
  done: "done",
} as const;
const NEXT_STATUS = {
  not_started: "in_progress",
  in_progress: "done",
  done: "not_started",
} as const;
type Status = keyof typeof STATUS_LABEL;

function StatusBadge({
  status,
  onCycle,
}: {
  readonly status: Status;
  readonly onCycle: () => void;
}) {
  return (
    <Badge
      variant={status === "done" ? "default" : status === "in_progress" ? "secondary" : "outline"}
      className="cursor-pointer select-none"
      render={<button type="button" onClick={onCycle} title="Click to change status" />}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function SubjectPage() {
  const [outline, threads] = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { subject } = outline;

  const refresh = () => router.invalidate();

  const discuss = async (anchor: Record<string, string>) => {
    setBusy(true);
    try {
      const thread = await rpc((api) => api["threads.create"]({ title: subject.title }));
      await rpc((api) => api["subjects.anchorThread"]({ threadId: thread.id, ...anchor }));
      await navigate({ to: "/chat/$threadId", params: { threadId: thread.id } });
    } finally {
      setBusy(false);
    }
  };

  const startExercise = async (exerciseId: string, restart = false) => {
    setBusy(true);
    try {
      const started = await rpc((api) =>
        api["exercises.start"]({ id: exerciseId as never, restart }),
      );
      await navigate({ to: "/chat/$threadId", params: { threadId: started.threadId } });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (
    ref: { readonly lessonId?: string; readonly exerciseId?: string },
    status: Status,
  ) => {
    await rpc((api) =>
      api["subjects.setStatus"]({
        lessonId: ref.lessonId as never,
        exerciseId: ref.exerciseId as never,
        status,
      }),
    );
    await refresh();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <div className="text-muted-foreground text-sm">
          <Link to="/subjects" className="hover:underline">
            Subjects
          </Link>{" "}
          /
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold">{subject.title}</h1>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void discuss({ subjectId: subject.id })}
          >
            <ChatIcon />
            Discuss
          </Button>
        </div>
        {subject.about.length > 0 && <p className="text-muted-foreground">{subject.about}</p>}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {subject.dueAt !== null && (
            <Badge variant="outline">due {DateTime.formatIsoDate(subject.dueAt)}</Badge>
          )}
          {subject.motivation.length > 0 && (
            <span className="text-muted-foreground">Why: {subject.motivation}</span>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-4">
        {outline.chapters.map((chapter) => (
          <div key={chapter.id} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-medium">
                {chapter.position}. {chapter.title}
              </h2>
              {chapter.dueAt !== null && (
                <Badge variant="outline">due {DateTime.formatIsoDate(chapter.dueAt)}</Badge>
              )}
            </div>
            {chapter.summary.length > 0 && (
              <p className="text-muted-foreground text-sm">{chapter.summary}</p>
            )}
            <ul className="flex flex-col gap-2">
              {chapter.lessons.map((lesson) => (
                <li key={lesson.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <PageIcon className="text-muted-foreground shrink-0" />
                    <Link
                      to="/doc/$documentId"
                      params={{ documentId: lesson.documentId }}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {chapter.position}.{lesson.position} {lesson.title}
                    </Link>
                    <StatusBadge
                      status={lesson.status}
                      onCycle={() =>
                        void setStatus({ lessonId: lesson.id }, NEXT_STATUS[lesson.status])
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title="Open a chat anchored to this lesson"
                      onClick={() => void discuss({ lessonId: lesson.id })}
                    >
                      <ChatIcon />
                    </Button>
                  </div>
                  {lesson.exercises.length > 0 && (
                    <ul className="flex flex-col gap-1 pl-6">
                      {lesson.exercises.map((exercise) => (
                        <li key={exercise.id} className="flex items-center gap-2 text-sm">
                          <SparkleIcon className="text-muted-foreground shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{exercise.title}</span>
                          <StatusBadge
                            status={exercise.status}
                            onCycle={() =>
                              void setStatus(
                                { exerciseId: exercise.id },
                                NEXT_STATUS[exercise.status],
                              )
                            }
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void startExercise(exercise.id)}
                          >
                            {exercise.status === "not_started" ? "Start" : "Continue"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {outline.chapters.length === 0 && (
          <p className="text-muted-foreground">
            No chapters yet — discuss the subject and the agent will draft an outline.
          </p>
        )}
      </section>

      {threads.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Threads</h2>
          <ul className="flex flex-col gap-1">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: thread.id }}
                  className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <ChatIcon className="text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {thread.title ?? `Chat · ${DateTime.formatIsoDate(thread.updatedAt)}`}
                  </span>
                  {thread.anchors.exerciseId !== null && <Badge variant="outline">exercise</Badge>}
                  {thread.anchors.lessonId !== null && <Badge variant="outline">lesson</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        {note === null ? (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() =>
              void rpc((api) => api["subjects.note"]({ id: subject.id })).then(setNote)
            }
          >
            Show the agent's private note
          </Button>
        ) : (
          <div className="bg-muted/40 rounded-lg border p-4">
            <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Agent note
            </div>
            <p className="text-sm whitespace-pre-wrap">
              {note.length > 0 ? note : "(nothing saved yet)"}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
