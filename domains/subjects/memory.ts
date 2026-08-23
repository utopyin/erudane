/**
 * Pure projection of a subject's memory into the system-prompt fragment a run
 * receives. No services, no IO — the chat route (tier 3) sequences the reads
 * and passes the result to the chat domain as its `system` string.
 */
import * as DateTime from "effect/DateTime";
import type { OutlineChapter, SubjectMemory, ThreadAnchors } from "./types";

export interface RunContext {
  readonly memory: SubjectMemory;
  readonly anchors?: ThreadAnchors | undefined;
  /** Present when the thread is anchored to a lesson: its document, as markdown. */
  readonly lessonMarkdown?: string | undefined;
  /** Present when the thread is anchored to an exercise. */
  readonly exerciseBrief?: string | undefined;
}

const date = (value: DateTime.Utc | null) =>
  value === null ? null : DateTime.formatIsoDate(value);

const statusMark = { not_started: " ", in_progress: "~", done: "x" } as const;

const outlineLines = (chapters: ReadonlyArray<OutlineChapter>, anchors?: ThreadAnchors) => {
  const lines: string[] = [];
  for (const chapter of chapters) {
    const here = anchors?.chapterId === chapter.id ? "  ← this thread" : "";
    const due = chapter.dueAt === null ? "" : ` (due ${date(chapter.dueAt)})`;
    lines.push(`${chapter.position}. ${chapter.title}${due} [chapter:${chapter.id}]${here}`);
    for (const lesson of chapter.lessons) {
      const mark = statusMark[lesson.status];
      const hereLesson = anchors?.lessonId === lesson.id ? "  ← this thread" : "";
      lines.push(
        `   ${chapter.position}.${lesson.position} [${mark}] ${lesson.title} [lesson:${lesson.id}] [document:${lesson.documentId}]${hereLesson}`,
      );
      for (const exercise of lesson.exercises) {
        const hereExercise = anchors?.exerciseId === exercise.id ? "  ← this thread" : "";
        lines.push(
          `      exercise ${exercise.position} [${statusMark[exercise.status]}] ${exercise.title} [exercise:${exercise.id}]${hereExercise}`,
        );
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(no chapters yet)";
};

/** The subject fragment of a run's system prompt. */
export const system = (context: RunContext): string => {
  const { memory } = context;
  const { subject } = memory;
  const sections: string[] = [];

  sections.push(
    `# Subject: ${subject.title}`,
    subject.about.length > 0 ? subject.about : "(no elaboration yet)",
    `Why the user is learning this: ${subject.motivation.length > 0 ? subject.motivation : "(unknown — worth asking)"}`,
    subject.dueAt === null ? "No deadline set." : `Deadline: ${date(subject.dueAt)}.`,
  );

  sections.push(
    "## Outline\nStatuses: [x] done, [~] in progress, [ ] not started. Use the bracketed ids to target tools.",
    outlineLines(memory.chapters, context.anchors),
  );

  const strengths = memory.skills.filter((skill) => skill.kind === "strength");
  const weaknesses = memory.skills.filter((skill) => skill.kind === "weakness");
  if (strengths.length > 0 || weaknesses.length > 0) {
    sections.push(
      "## The user",
      ...(strengths.length > 0
        ? [
            `Strong at (build on these, good for parallels):\n${strengths.map((s) => `- ${s.text}`).join("\n")}`,
          ]
        : []),
      ...(weaknesses.length > 0
        ? [`Needs to deepen (slow down here):\n${weaknesses.map((s) => `- ${s.text}`).join("\n")}`]
        : []),
    );
  }

  if (memory.note.length > 0) {
    sections.push(
      "## Your private note (from earlier threads — not shown to the user)",
      memory.note,
    );
  }

  if (context.lessonMarkdown !== undefined) {
    sections.push(
      "## The lesson document this thread is anchored to\nYou co-edit it live with the user through ReadDocument/EditDocument.",
      context.lessonMarkdown,
    );
  }

  if (context.exerciseBrief !== undefined) {
    sections.push(
      "## The exercise this thread runs\nYou opened this thread with the brief below; lead the user through it.",
      context.exerciseBrief,
    );
  }

  return sections.join("\n\n");
};
