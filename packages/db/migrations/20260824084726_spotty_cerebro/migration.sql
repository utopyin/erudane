CREATE TYPE "eru_document_actor" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "eru_item_status" AS ENUM('not_started', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "eru_skill_kind" AS ENUM('strength', 'weakness');--> statement-breakpoint
CREATE TABLE "eru_documents" (
	"id" uuid PRIMARY KEY,
	"title" text DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"state" bytea,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" "eru_document_actor",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_chapters" (
	"id" uuid PRIMARY KEY,
	"subject_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_exercises" (
	"id" uuid PRIMARY KEY,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"status" "eru_item_status" DEFAULT 'not_started'::"eru_item_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_lessons" (
	"id" uuid PRIMARY KEY,
	"chapter_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"status" "eru_item_status" DEFAULT 'not_started'::"eru_item_status" NOT NULL,
	"document_id" uuid NOT NULL UNIQUE,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_subject_note_revisions" (
	"id" uuid PRIMARY KEY,
	"subject_id" uuid NOT NULL,
	"note" text NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_subject_skills" (
	"id" uuid PRIMARY KEY,
	"subject_id" uuid NOT NULL,
	"kind" "eru_skill_kind" NOT NULL,
	"text" text NOT NULL,
	"source_thread_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_subjects" (
	"id" uuid PRIMARY KEY,
	"title" text NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"motivation" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eru_threads" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD COLUMN "lesson_id" uuid;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD COLUMN "exercise_id" uuid;--> statement-breakpoint
CREATE INDEX "eru_threads_subject_id_updated_at_index" ON "eru_threads" ("subject_id","updated_at");--> statement-breakpoint
CREATE INDEX "eru_chapters_subject_id_position_index" ON "eru_chapters" ("subject_id","position");--> statement-breakpoint
CREATE INDEX "eru_exercises_lesson_id_position_index" ON "eru_exercises" ("lesson_id","position");--> statement-breakpoint
CREATE INDEX "eru_lessons_chapter_id_position_index" ON "eru_lessons" ("chapter_id","position");--> statement-breakpoint
CREATE INDEX "eru_subject_skills_subject_id_kind_index" ON "eru_subject_skills" ("subject_id","kind");--> statement-breakpoint
ALTER TABLE "eru_threads" ADD CONSTRAINT "eru_threads_subject_id_eru_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "eru_subjects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD CONSTRAINT "eru_threads_chapter_id_eru_chapters_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "eru_chapters"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD CONSTRAINT "eru_threads_lesson_id_eru_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "eru_lessons"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eru_threads" ADD CONSTRAINT "eru_threads_exercise_id_eru_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "eru_exercises"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eru_chapters" ADD CONSTRAINT "eru_chapters_subject_id_eru_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "eru_subjects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_exercises" ADD CONSTRAINT "eru_exercises_lesson_id_eru_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "eru_lessons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_lessons" ADD CONSTRAINT "eru_lessons_chapter_id_eru_chapters_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "eru_chapters"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_lessons" ADD CONSTRAINT "eru_lessons_document_id_eru_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "eru_documents"("id");--> statement-breakpoint
ALTER TABLE "eru_subject_note_revisions" ADD CONSTRAINT "eru_subject_note_revisions_subject_id_eru_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "eru_subjects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_subject_skills" ADD CONSTRAINT "eru_subject_skills_subject_id_eru_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "eru_subjects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eru_subject_skills" ADD CONSTRAINT "eru_subject_skills_source_thread_id_eru_threads_id_fkey" FOREIGN KEY ("source_thread_id") REFERENCES "eru_threads"("id") ON DELETE SET NULL;