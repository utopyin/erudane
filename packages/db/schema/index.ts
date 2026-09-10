import { defineRelations } from "drizzle-orm";
import { messages, threads } from "./chat";
import { files } from "./files";
import { documents } from "./documents";
import {
  chapters,
  exercises,
  lessons,
  subjectNoteRevisions,
  subjects,
  subjectSkills,
} from "./subjects";

export * from "./chat";
export * from "./files";
export * from "./documents";
export * from "./subjects";

export const relations = defineRelations(
  {
    files,
    threads,
    messages,
    subjects,
    chapters,
    lessons,
    exercises,
    subjectSkills,
    subjectNoteRevisions,
    documents,
  },
  (r) => ({
    threads: {
      messages: r.many.messages(),
      subject: r.one.subjects({ from: r.threads.subjectId, to: r.subjects.id }),
    },
    messages: { thread: r.one.threads({ from: r.messages.threadId, to: r.threads.id }) },
    subjects: {
      chapters: r.many.chapters(),
      skills: r.many.subjectSkills(),
      noteRevisions: r.many.subjectNoteRevisions(),
      threads: r.many.threads(),
    },
    chapters: {
      subject: r.one.subjects({ from: r.chapters.subjectId, to: r.subjects.id }),
      lessons: r.many.lessons(),
    },
    lessons: {
      chapter: r.one.chapters({ from: r.lessons.chapterId, to: r.chapters.id }),
      document: r.one.documents({ from: r.lessons.documentId, to: r.documents.id }),
      exercises: r.many.exercises(),
    },
    exercises: { lesson: r.one.lessons({ from: r.exercises.lessonId, to: r.lessons.id }) },
    subjectSkills: {
      subject: r.one.subjects({ from: r.subjectSkills.subjectId, to: r.subjects.id }),
    },
    subjectNoteRevisions: {
      subject: r.one.subjects({ from: r.subjectNoteRevisions.subjectId, to: r.subjects.id }),
    },
  }),
);

export type File = typeof files.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type SubjectSkill = typeof subjectSkills.$inferSelect;
export type Document = typeof documents.$inferSelect;
