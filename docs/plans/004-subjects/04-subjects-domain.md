# `domains/subjects` — `@erudane/subjects`

Owns the subject concept end to end: the outline (chapters → lessons → exercises), the memory (structured fields, skills, the agent note), thread anchoring, and the agent's tools over all of it. Tier 2; depends downward on `@erudane/db`, `effect`, and sideways on `@erudane/chat` (one direction — chat never imports subjects) and `@erudane/documents` (05).

```
domains/subjects/
  package.json     exports: ".", "./types", "./errors", "./tools", "./rpc", "./repo", "./service", "./memory", "./exercises"
  types.ts         LEAF. Ids (SubjectId, ChapterId, LessonId, ExerciseId), ItemStatus, Schema.Class
                   shapes: Subject, Chapter, Lesson, Exercise, Skill, Outline (the full tree),
                   SubjectMemory (what the prompt builder consumes). Closure: effect only.
  errors.ts        LEAF. SubjectNotFound, ChapterNotFound, LessonNotFound, ExerciseNotFound,
                   OutOfRange (bad position), RepoError. Closure: effect only.
  ids.ts           uuid Effects per id brand (same pattern as chat/ids.ts).
  repo.ts          SubjectRepo service: the one aggregate repository (drizzle layer + memory layer).
  service.ts       Subjects service: behaviour over the repo (outline mutations with resequencing,
                   status transitions, note rewrite + revision, skills rewrite, thread anchoring).
  memory.ts        prompt projection: SubjectMemory → the system-prompt fragment for a run
                   (structured fields, skills, note, anchored lesson's markdown). Pure.
  exercises.ts     ExerciseRuns service: start(exerciseId) — create the thread anchored to the
                   exercise, seed the agent-led opening from `brief`. Depends on chat's ThreadRepo.
  tools.ts         LEAF (imports ./types, ./errors, effect only). Agent tool definitions (below).
  handlers.ts      tool handler layer, requires Subjects.Service (+ Documents from 05).
  rpc.ts           LEAF (imports ./types, ./errors, effect only). RpcGroup contract (06).
```

Single-service modules follow the house pattern: file-local `Interface` / `Service` / `layer`, one namespace export from the bottom (`export * as SubjectRepo from "./repo"` etc.). Tag ids: `@erudane/subjects/SubjectRepo`, `@erudane/subjects/Subjects`, `@erudane/subjects/ExerciseRuns`.

## `SubjectRepo` — one repository for the aggregate

The outline is one aggregate: chapters/lessons/exercises have no meaning outside their subject, and every outline mutation resequences siblings transactionally. One repo keeps that in one transaction boundary; per-table repos would smear it.

```ts
interface Interface {
  create:   (subject: NewSubject) => Effect<Subject, RepoError, Database.Runtime>
  get:      (id: SubjectId) => Effect<Option<Subject>, RepoError, Database.Runtime>
  list:     () => Effect<ReadonlyArray<Subject>, RepoError, Database.Runtime>
  outline:  (id: SubjectId) => Effect<Outline, RepoError | SubjectNotFound, Database.Runtime>
  update:   (id: SubjectId, patch: SubjectPatch) => Effect<Subject, RepoError | SubjectNotFound, Database.Runtime>

  // outline mutations — each one transaction, resequences positions, bumps subject.updatedAt
  insertChapter:  (subjectId, at: Option<number>, fields) => Effect<Chapter, …>
  insertLesson:   (chapterId, at: Option<number>, fields, documentId) => Effect<Lesson, …>
  insertExercise: (lessonId,  at: Option<number>, fields) => Effect<Exercise, …>
  move / removeChapter|Lesson|Exercise, updateChapter|Lesson|Exercise (title, summary, dueAt, brief)
  setStatus: (ref: LessonId | ExerciseId, status: ItemStatus) => Effect<void, …>

  // memory
  replaceSkills: (subjectId, skills: ReadonlyArray<NewSkill>) => Effect<ReadonlyArray<Skill>, …>
  rewriteNote:   (subjectId, note: string) => Effect<void, …>   // archives old value to note_revisions
  memory:        (subjectId) => Effect<SubjectMemory, …>        // subject + skills + outline summary in one read

  // thread anchoring — the only writer of the eru_threads anchor columns
  anchorThread:  (threadId, anchor: Anchor) => Effect<void, RepoError | …NotFound, Database.Runtime>
  threadsOf:     (subjectId) => Effect<ReadonlyArray<AnchoredThread>, RepoError, Database.Runtime>
}
```

`Anchor` is a tagged union — `Subject { subjectId } | Chapter { chapterId } | Lesson { lessonId } | Exercise { exerciseId }`; the repo resolves the parent chain and writes `subjectId` + the one deepest column, keeping the invariant from 03 in one place. `memory` is the read the chat route uses per run — one round trip, no N+1.

Two layers as always: `layer` (drizzle) and `memory` (Ref-backed, for scratch scripts).

## `Subjects` service — behaviour, not storage

Thin today (most calls delegate to the repo), but it is the seam where behaviour accrues: creating a lesson also creates its empty document (calls `Documents.create` from 05, then `repo.insertLesson` with the id); note rewrite validates length; outline mutations validate positions. RPC handlers and tool handlers both call **this**, never the repo — one write path whether the actor is the user or the agent (the D-level decision behind "both can do everything").

## `ExerciseRuns` — the agent-led thread

`start(exerciseId)`:

1. `repo` loads the exercise + its lesson/chapter/subject (for the anchor and the prompt).
2. Mints a `ThreadId`, `chat.ThreadRepo.create({ id, title: exercise.title })`.
3. `repo.anchorThread(threadId, Anchor.Exercise(...))`.
4. Appends the opening **assistant** message built from `brief` via `chat.ThreadRepo.append` — the thread starts already-spoken; the user lands in a conversation the agent has opened with the exercise context and first question.
5. Sets the exercise `in_progress`.

Idempotence: `start` on an exercise that already has a thread returns the newest anchored thread instead of creating another; an explicit `restart` creates a fresh one (retries are N threads per exercise, 03).

The opening message is authored from `brief` verbatim (deterministic, no model call) — the agent wrote `brief` when it created the exercise; making `start` call the model would couple exercise start to model availability for no gain. If we later want a generated opener, the seam is this one function.

## Tools — how the agent updates the subject

`tools.ts` is a leaf module like `chat/tools.ts` (the web app imports it to type tool-call parts). All server-executed, `failureMode: "return"` so the model sees typed failures and can correct.

| Tool               | Payload → success                                        | Backed by                |
| ------------------ | -------------------------------------------------------- | ------------------------ |
| `CreateSubject`    | title, about, motivation, dueAt?, initial outline?       | `Subjects.create`        |
| `UpdateSubject`    | subjectId, patch (about/motivation/dueAt/title)          | `Subjects.update`        |
| `EditOutline`      | subjectId, ops: insert/move/remove/update chapter‖lesson‖exercise | outline mutations |
| `SetStatus`        | lessonId or exerciseId, status                           | `Subjects.setStatus`     |
| `SaveNote`         | subjectId, note (full replacement)                       | `Subjects.rewriteNote`   |
| `UpdateSkills`     | subjectId, strengths: string[], weaknesses: string[], sourceThreadId? | `replaceSkills` |
| `CreateExercise`   | lessonId, title, brief, at?                              | `insertExercise`         |
| `ReadDocument`     | documentId → markdown                                    | Documents (05)           |
| `EditDocument`     | documentId, edits → applied live                         | Documents (05)           |

The registry stays where it is (tier 3, `entrypoints/http/chat/registry.ts`) and now adds `SubjectTools` to the existing `ChatTools` + `ResearchTools` merge; the handler layers are provided in the worker init alongside the existing ones. The chat domain still knows only `Toolkit` — it never learns subjects exist.

`EditOutline` takes a **batch of ops** rather than one tool per mutation: the agent typically restructures several items at once, and a batch is one transaction, one tool round.

## The subject-aware run (tier-3 composition, chat stays blind)

`POST /chat` today builds `system` from a constant. With subjects, the route (04 stays tier 3):

1. Reads the thread's anchors (`SubjectRepo`, by threadId).
2. Un-anchored → today's behaviour, plus the subject tools (so a plain chat can *create* subjects — lesson-less mode as the entrypoint).
3. Anchored → `repo.memory(subjectId)` + (if lesson/exercise-anchored) the lesson's `markdown` and/or the exercise `brief` → `memory.ts`'s pure prompt builder → `system`.

`Run`, `Chat`, `ThreadRepo` are untouched. The prompt builder lives in the subjects domain (it is subject behaviour); the route only sequences reads and passes the string in — same pattern as the existing registry split.

## Dependency picture

```
subjects ──▶ chat (ThreadRepo: create/append for exercise threads; Thread shape)
subjects ──▶ documents (create doc with lesson, read markdown for prompts)   [05]
subjects ──▶ db (schema + Database.Service)
chat ─X──▶ subjects   (never)
entrypoints/http ──▶ subjects, chat, documents (registry, routes, rpc)
```

No cycles: chat remains the lower domain. The one place that reads both chat and subjects state per request is tier 3, as CONTEXT.md prescribes for assembly.
