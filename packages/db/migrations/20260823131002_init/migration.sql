CREATE TYPE "eru_message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TABLE "eru_messages" (
	"id" uuid PRIMARY KEY,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "eru_message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_threads" (
	"id" uuid PRIMARY KEY,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "eru_messages_thread_id_seq_index" ON "eru_messages" ("thread_id","seq");--> statement-breakpoint
ALTER TABLE "eru_messages" ADD CONSTRAINT "eru_messages_thread_id_eru_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "eru_threads"("id") ON DELETE CASCADE;