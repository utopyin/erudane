# Package Architecture

Defines how packages in this monorepo may depend on each other: the four tiers, what belongs in each, and the vocabulary for diagnosing an illegal edge. The four tiers are four real directories, so placement is visible in the file tree and in every diff.

## The four tiers

| #   | Tier            | Directory      | Contains                                                            | Membership test                                          |
| --- | --------------- | -------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | **Packages**    | `packages/`    | mechanism, shapes, infrastructure clients, cross-boundary contracts | Knows about no concept, or only the _shape_ of one       |
| 2   | **Domains**     | `domains/`     | `chat`, later `courses`, `learners`, …                              | Owns one concept end to end                              |
| 3   | **Entrypoints** | `entrypoints/` | `http`, later `rpc`, `jobs`, …                                      | Assembles domains into a transport, protocol, or surface |
| 4   | **Apps**        | `apps/`        | `web`, `api`                                                        | Deployables and runtimes. Imported by nobody             |

Workspace package names are `@erudane/<dir>` regardless of tier; the tier is the directory.

## The two rules

**1. Depend downward, or sideways.** A package may import any package in a lower tier and any package in its own tier. It may never import a higher tier.

**2. No cycles, ever.** Within a tier, dependencies form a DAG. `A -> B` declares B the lower-level concept; `A <-> B` is banned at any length.

Rule 2 is the hard failure. Rule 1 is the scoreboard.

## Language

**Tier**: one of the four ranks above. _Avoid_: layer, level.

**Domain**: a tier-2 package owning one concept end to end — deep knowledge of one thing. Domains may depend on each other in one direction only.

**Horizontal**: a package spanning every concept — shallow knowledge of everything. Legal only as a **substrate horizontal** (tier 1: mechanism or shapes, no concept behaviour) or an **assembly horizontal** (tier 3–4: composes domains into a transport or runtime). A **middle horizontal** — depended on by domains _and_ depending on them — cycles by construction and is forbidden.

**Sink**: imports nothing, imported by many (bottom of the graph). **Root**: imports many, imported by nothing (apps). "Leaf" is ambiguous between the two; say which.

**Closure**: the transitive set of files an import pulls in and the highest tier it reaches. The true cost of a module, as opposed to its direct imports. Never judge a module's tier by its direct imports.

**Leaf submodule**: a lower-tier module living inside a higher-tier package, importable from below because its closure provably stays below the importer — e.g. `@erudane/chat/tools`. The rule that keeps it true: **a contract module must not import its own domain's implementation.** The moment it imports a service or handler, every importer inherits the whole domain.

**Upward edge**: an import from a lower tier to a higher one. **Same-tier cycle**: a loop inside one tier — the hard failure.

## Relationships

- **Entrypoint → domain**: entrypoints import every domain they assemble. No domain imports an entrypoint. A domain that seems to need one is missing something in tier 1.
- **App → domain / entrypoint**: runtimes compose layers and implement the contracts domains declare (providers, secrets, bindings). Domains never import a runtime.
- **Domain → domain**: one direction only. A mutual pair is resolved by merging, extracting downward, inverting through a contract, or relocating a misfiled file — never by copying code.
- **Shape crossing a boundary → tier 1 (or a measured leaf submodule)**: a type or constant defined in the first package that needed it is the most common cause of an illegal edge. Move it down.
- **Entrypoint-neutral services**: domain services speak Effect (`Stream`, `Effect`, typed errors). Protocol shapes (SSE, AG-UI, RPC envelopes) are adapted in tier 3, never inside a domain.

## Where new code goes

1. **Does it know about a concept?** No — tier 1. Yes — continue.
2. **Does it know about more than one concept?** Yes — it is horizontal; it belongs in tier 3/4 unless it is pure mechanism, in which case strip the concept knowledge and it becomes tier 1. Never in between.
3. **Is it a shape that crosses a boundary, or behaviour?** Shape — tier 1 or a leaf submodule. Behaviour — tier 2, in the domain that owns the concept.

If step 3 leaves you unsure which domain owns it, that is a finding: the concept has no owning package yet. Note it rather than filing the code next to something that looks similar.

## Enforcement

Not yet automated. A `scripts/dep-map.ts` (tier assignment, SCC detection, `closure <specifier>` report) is planned; until then every leaf-submodule claim is checked by reading the module's imports.
