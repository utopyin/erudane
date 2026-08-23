# Schema

All tables through `table()` (`eru_` prefix, snake_case), added to `packages/db/schema.ts` and `relations`. One migration folder generated at the end of the schema phase.

## The hierarchy

```
eru_subjects 1 ─── n eru_chapters 1 ─── n eru_lessons 1 ─── n eru_exercises
     │                                        │ 1                  │ 1
     │ 1                                      │                    │
     n eru_subject_skills                     1 eru_documents      n eru_threads (exerciseId)
     │ 1
     n eru_subject_note_revisions
     │ 1
     n eru_threads (subjectId)
```

Ordering inside a parent is an `integer` `position`, resequenced transactionally on outline writes (insert/move/delete renumber the affected siblings). The numbered lists the user sees are literally these integers. Fractional indexing is not needed: outline edits go through one repository, single-tenant, low write rate.

## `eru_subjects`

| column      | type                        | notes                                                       |
| ----------- | --------------------------- | ----------------------------------------------------------- |
| `id`        | `uuid` PK                   | minted by domain (`Ids.subjectId`)                          |
| `title`     | `text` not null             | what the subject is, short                                  |
| `about`     | `text` not null default ''  | what the subject is, elaborated (agent-refined)             |
| `motivation`| `text` not null default ''  | why the user wants to learn it                              |
| `dueAt`     | `timestamptz` null          | deadline to learn the subject                               |
| `note`      | `text` not null default ''  | the agent's private note — hidden in the UI by default      |
| `createdAt` | `timestamptz` not null      |                                                             |
| `updatedAt` | `timestamptz` not null      | bumped by any write inside the subject aggregate            |

## `eru_chapters`

| column      | type                   | notes                          |
| ----------- | ---------------------- | ------------------------------ |
| `id`        | `uuid` PK              |                                |
| `subjectId` | `uuid` FK → subjects, cascade | |
| `position`  | `integer` not null     | 1-based, unique per subject (enforced by repo, not DB — resequencing would trip a unique index mid-transaction) |
| `title`     | `text` not null        |                                |
| `summary`   | `text` not null default '' | one-paragraph agent summary, shown in outline |
| `dueAt`     | `timestamptz` null     |                                |
| `createdAt` / `updatedAt` | `timestamptz` | |

Index: `(subjectId, position)`.

## `eru_lessons`

| column       | type                  | notes                                                  |
| ------------ | --------------------- | ------------------------------------------------------ |
| `id`         | `uuid` PK             |                                                        |
| `chapterId`  | `uuid` FK → chapters, cascade | |
| `position`   | `integer` not null    |                                                        |
| `title`      | `text` not null       |                                                        |
| `status`     | `eru_item_status` not null default `'not_started'` | `not_started \| in_progress \| done`; set by user (RPC) or agent (tool) |
| `documentId` | `uuid` FK → documents, unique, not null | created with the lesson (empty doc), 1:1 |
| `dueAt`      | `timestamptz` null    |                                                        |
| `createdAt` / `updatedAt` | `timestamptz` | |

Index: `(chapterId, position)`.

## `eru_exercises`

An exercise is **an agent-led thread**: when the user starts it, the domain creates a thread anchored to the exercise and seeds it with an assistant message built from `brief` (the agent's exercise context + first question), so the user opens a conversation that has already begun.

| column      | type                  | notes                                                       |
| ----------- | --------------------- | ----------------------------------------------------------- |
| `id`        | `uuid` PK             |                                                             |
| `lessonId`  | `uuid` FK → lessons, cascade | |
| `position`  | `integer` not null    |                                                             |
| `title`     | `text` not null       |                                                             |
| `brief`     | `text` not null       | agent-authored: what to exercise, how to run it, the opening question |
| `status`    | `eru_item_status` not null default `'not_started'` | |
| `createdAt` / `updatedAt` | `timestamptz` | |

Index: `(lessonId, position)`. No `threadId` column: threads point at exercises (below), so retries are N threads per exercise and "the exercise's thread" is the newest.

## `eru_subject_skills`

What the user is good/bad at in this subject. A list the agent rewrites through a tool; each row remembers where the agent learned it.

| column           | type                        | notes                              |
| ---------------- | --------------------------- | ---------------------------------- |
| `id`             | `uuid` PK                   |                                    |
| `subjectId`      | `uuid` FK → subjects, cascade | |
| `kind`           | `eru_skill_kind` not null   | `strength \| weakness`             |
| `text`           | `text` not null             | one short statement                |
| `sourceThreadId` | `uuid` FK → threads, null, on delete set null | where this was observed |
| `createdAt` / `updatedAt` | `timestamptz`      |                                    |

Index: `(subjectId, kind)`.

## `eru_subject_note_revisions`

The previous value of `subjects.note`, written on every rewrite so a bad agent rewrite is recoverable. Append-only, pruned never (rows are tiny).

| column      | type                   | notes                       |
| ----------- | ---------------------- | --------------------------- |
| `id`        | `uuid` PK              |                             |
| `subjectId` | `uuid` FK → subjects, cascade | |
| `note`      | `text` not null        | the value being replaced    |
| `replacedAt`| `timestamptz` not null |                             |

## `eru_documents`

The lesson's written document. Authority on content is the collab layer (05); Postgres holds the durable projection the rest of the system reads.

| column      | type                       | notes                                                       |
| ----------- | -------------------------- | ----------------------------------------------------------- |
| `id`        | `uuid` PK                  | also the collab room id                                     |
| `title`     | `text` not null default '' |                                                             |
| `markdown`  | `text` not null default '' | model-facing projection: what the agent reads as lesson context, what search will index |
| `state`     | `bytea` null               | latest CRDT snapshot, for cold-starting the collab room and backup |
| `version`   | `integer` not null default 0 | bumped per projection write; optimistic concurrency for non-collab writers |
| `updatedBy` | `eru_document_actor` null  | `user \| agent` — who caused the last projection write      |
| `createdAt` / `updatedAt` | `timestamptz` |                                                             |

> The exact `state`/projection write path (who writes it, when) is fixed in [05-documents-collab](./05-documents-collab.md).

Version *history* (see revisions) rides on the CRDT's own update log in the collab layer, not on extra Postgres tables — decided in 05.

## `eru_threads` — anchor columns (added)

Everything optional. A thread with no anchors is a plain chat — "lesson-less mode", the entrypoint for creating subjects or new chapters/lessons from conversation.

| column       | type                                   | notes |
| ------------ | -------------------------------------- | ----- |
| `subjectId`  | `uuid` FK → subjects, null, cascade    | set whenever any anchor is set (denormalized for "threads of subject") |
| `chapterId`  | `uuid` FK → chapters, null, set null   | |
| `lessonId`   | `uuid` FK → lessons, null, set null    | |
| `exerciseId` | `uuid` FK → exercises, null, set null  | |

Invariant (repo-enforced, not DB): at most one of `chapterId`/`lessonId`/`exerciseId` is set — the deepest anchor; `subjectId` is always set alongside and always the anchor's subject. Index: `(subjectId, updatedAt)`.

Ownership: the chat domain keeps owning `id/title/createdAt/updatedAt` and messages; the anchor columns are **written only by the subjects domain** (its own repo). Two domains touch one table, but each owns disjoint columns — the table is a tier-1 shape, the behaviour stays in one domain per column set (see 04).

## Enums

- `eru_item_status`: `not_started | in_progress | done`
- `eru_skill_kind`: `strength | weakness`
- `eru_document_actor`: `user | agent`

## Deferred

- **Files loaded from threads** (user-stated hold): will be `eru_subject_files(subjectId, documentId | blob ref, sourceThreadId)`; nothing in this schema blocks it.
- **Ownership** (D21 still): no `owner_id` anywhere until the auth plan.
- **Per-exercise grading record**: the assessment lives in the exercise thread's messages for now; a structured `eru_exercise_results` table is additive later.
