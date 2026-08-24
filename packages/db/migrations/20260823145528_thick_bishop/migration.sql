CREATE TABLE "eru_files" (
	"id" uuid PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"media_type" text NOT NULL,
	"file_name" text,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
