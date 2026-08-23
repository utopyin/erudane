## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Think long term

When approaching a fix, ask yourself if the issue is a sign of a deeper problem. If that's the case, propose the local, minimal fix and if relevant, explain the deeper fix.

Example: The user requests to fix a bug where we a billing policy in the frontend does not match the billing policy in the backend. The easy fix is to change either one of the two policies, and the actual long-term fix is to ensure frontend and backend share the same source of truth and logical piece.

When approaching a new feature, don't just try to model the least amount of code or changes. You own every new feature and must think long term. Think beyond this feature, and how it fits into the overall architecture, domains it touches, and how it interacts with existing features.

We very rarely write test files, so by default you should not think about test coverage if not mentionned explicitely by the user.

## Vendored Repositories

This project vendors external repositories under `repos/`.

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under `repos/`
- Do not import from `repos/` - application code should continue importing from normal package dependencies

`repos/effect/` is the canonical **Effect v4** source from `https://github.com/Effect-TS/effect.git`, pinned to the `effect` version in the root Bun catalog (`4.0.0-beta.100`). Refresh it from `main` with `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`. Before writing or migrating any Effect code, read `repos/effect/LLMS.md` and the relevant guide under `repos/effect/migration/` (e.g. `services.md`, `error-handling.md`, `cause.md`, `v3-to-v4.md`). Trust this vendored source over web search or training data, which often reflect Effect v3 or a different v4 beta.

Use `repos/` for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns.

## 4. Dos and don'ts

**Commits:** Use the repo’s terse conventional style: `action(scope): imperative change` when a scope helps (`feat(admin): show feature flags`), otherwise `action: imperative change` or the existing domain prefix (`repo:`, `api:`, `cv2:`).

**Import focused modules from their subpath. Let the path provide scope.**

- When a package exposes a focused subpath (`@erudane/foo/bar`), import from that subpath instead of the package root.
- Do not re-export subpath symbols from the root entry unless there is a strong reason. Keep root exports for the general surface only.

**Module exports**

- If `@erudane/foo/bar` already scopes the code, prefer short local names there: `CommandInput`, `NotImplemented`, `ServiceShape`.
- Keep long/global names only for identifiers that must stay distinct in traces, DI, or cross-package search — Effect service **tag ids** (`"@erudane/x/Accounts"`) and repo names. The class holding that tag still takes a short local name.
- Single-service Effect modules use file-local role names (`Interface`, `Service`, `layer`) and project one canonical namespace from the bottom of the file: `export * as Accounts from "./accounts.js"`. See `.agents/skills/effect-design/references/services-layers.md`.
- If importers needs a shape, export it from the domain module's `types.ts` / `errors.ts`, so that it's DRY and there's one source of truth.
- Always try to minimize the public interface / exports of a module. Only export types or functions that need to be imported explicitely outside the module, and ensure the we keep the module exports as high level as possible (Deep modules principle).

**File and directory naming.**

The import path is the sentence; the filename is its last word. `@erudane/billing/trial/promise` reads well because `trial/` carries the scope, so `promise.ts` gets to be one word. A long hyphenated filename is a diagnostic, not a style violation — it usually means the file sits in the wrong directory, the directory is badly named, or the file should not exist on its own. Use judgement here; the point is to notice when a new file's name obviously doesn't make sense, not to police every hyphen.

- Don't repeat a word an ancestor directory already supplies. `campaigns/actions/common/get-campaign-target-execution-state.ts` says "campaign" twice and "action" once, all already in the path.
- Files are nouns; the exported function is the verb. `getSyncProgress` belongs in `progress.ts`, not `get-sync-progress.ts`.
- Two hyphen-joined words is the practical ceiling, and only when they form one concept the path doesn't already give you (`plan-switch`, `rate-limit`, `raw-query`). Three or more usually means the path is wrong.
- Prefer the established role vocabulary inside a domain directory: `index`, `types`, `errors`, `service`, `promise`, `client`, `layer`, `resolver`, `state`, `keys`, `constants`, `utils` — plus plain domain nouns (`wallet`, `packs`, `eligibility`, `lifecycle`).
- `common/` and `shared/` are not scope. They add a path segment without adding meaning, which pushes all the meaning back into filenames. Name the directory for what's in it.

When a name gets long, in order:

1. **Drop the redundant words** the path already carries.
2. **Fold it into a generic sibling** — `utils.ts`, `types.ts`, `errors.ts`, `constants.ts` — in the nearest correct directory. A single-purpose helper does not deserve its own file.
3. **Promote to a directory**, but only with two or more files in it. The directory takes the leading segments, the files take the tail. Never create a directory for one file unless a framework requires it.
