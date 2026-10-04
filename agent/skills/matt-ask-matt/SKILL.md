---
name: matt-ask-matt
description: Ask which installed Matt Pocock-derived skill or flow fits the current situation.
disable-model-invocation: true
license: MIT (see LICENSE)
metadata:
  upstream-repository: https://github.com/mattpocock/skills
  upstream-commit: 24fe0ef7737efae15c87225755e9f6f5965e4888
  upstream-path: skills/engineering/ask-matt
  adaptation: Curated Pi router for the installed matt-* skill subset
---

# Ask Matt

Route the user's situation to the smallest fitting flow from the installed `matt-*` skills. Explain the recommendation briefly, then ask whether they want to invoke it. Do not start the recommended skill until the user confirms.

## Setup precondition

For repository workflows that use issue tracking or Wayfinder, resolve the project's configured tracker first. If setup is missing, tell the user to run `/skill:matt-setup-skills`; do not silently select a tracker. Setup also migrates legacy `CONTEXT.md` / `CONTEXT-MAP.md` to `GLOSSARY.md` / `GLOSSARY-MAP.md`. Existing legacy projects remain usable through [the temporary glossary discovery policy](../matt-domain-modeling/GLOSSARY-COMPATIBILITY.md).

## Primary routes

- **Sharpen an idea in a repository** → `/skill:matt-grill-with-docs`. It combines the relentless interview with active domain modeling, updating the resolved `GLOSSARY.md` (or legacy glossary until migrated) and offering ADRs when warranted.
- **Sharpen an idea without repository documentation** → `/skill:matt-grill-me`. It runs the same interview without creating domain documents.
- **Turn a completed discussion into a durable implementation spec** → `/skill:matt-to-spec`. It synthesizes the conversation without reopening requirements and publishes the result to the configured issue tracker.
- **Split a spec or plan into executable vertical slices** → `/skill:matt-to-tickets`. It creates tracker tickets with acceptance criteria and blocking relationships.
- **Plan a huge, foggy, multi-session effort** → `/skill:matt-wayfinder`. Use only when the path to the destination cannot fit in one session; it maps decision tickets rather than implementation work.
- **Answer a design question with something runnable or visible** → `/skill:matt-prototype`. Use for state/logic questions or several substantially different UI directions.
- **Survey architectural friction** → `/skill:matt-improve-codebase-architecture`. It finds deepening opportunities, presents a visual report, and grills through the chosen candidate.
- **Research facts from primary sources** → `/skill:matt-research`. It uses an awaited Pi subagent and records cited findings in the repository.
- **Retrospect a coding session for improvements to the agent's environment** → `/skill:matt-retro`. Use it to surface and rank improvements; it presents candidates rather than implementing them.
- **Triage incoming issues or external pull requests** → `/skill:matt-triage`. It verifies claims, fills requirement gaps, and produces durable agent briefs with tracker states.
- **Implement a ticket or small spec in one session** → `/skill:matt-implement`. It uses `matt-tdd` where possible, runs project checks, and closes with `matt-code-review`.
- **Orchestrate a whole ticketed spec** → `/skill:matt-implement-spec`. It schedules the ready task-graph frontier in separate worktrees, integrates onto one branch, and closes with a combined review.
- **Write a PR body** → `matt-pr`. This model-invoked reference supplies a compact visual summary, before/after evidence, and merge danger; read [its instructions](../matt-pr/SKILL.md) when an authorized workflow is writing a PR body. Formatting a body is not authorization to publish a PR.
- **Build one behavior test-first** → `/skill:matt-tdd`. Use for a direct red-green loop without the larger implementation wrapper.
- **Review a branch or work-in-progress diff** → `/skill:matt-code-review`. It reviews Standards and Spec as separate axes.
- **Carry work into another session, directory, or agent** → `/skill:matt-handoff`. It writes a compact temporary handoff document with pointers to existing artifacts.
- **Learn a topic across multiple sessions** → `/skill:matt-teach`. It turns the current directory into a stateful teaching workspace.
- **Re-pitch the previous explanation** → `/skill:matt-wait-what`. Use when the last message did not land and needs clearer context and simpler language.

## Vocabulary and reusable disciplines

These are model-invoked skills that can also be requested directly:

- **Relentless interview mechanics** → `matt-grilling`.
- **Project terminology, `GLOSSARY.md` (including legacy docs), or ADRs** → `matt-domain-modeling`.
- **Deep modules, interfaces, seams, locality, and leverage** → `matt-codebase-design`.
- **Test-driven implementation** → `matt-tdd`.
- **Two-axis Standards and Spec review** → `matt-code-review`.

## Main build flow

Sharpen with `matt-grill-with-docs`; detour through `matt-prototype` when conversation cannot settle a design question, using `matt-handoff` to cross directories/sessions and bring findings back. Once decisions are settled, use `matt-to-spec`, then `matt-to-tickets` for multi-session work. Keep the discovery/spec/ticket context together where possible; persist a handoff before crossing a context boundary.

Then choose per-ticket `matt-implement` in fresh sessions, or `matt-implement-spec` to orchestrate the whole graph. Both use TDD and close with two-axis code review. Use `matt-pr` when writing the PR body, retaining project-specific evidence requirements. Offer `matt-retro` after the build/review, especially when the session went sideways; run it before clearing context, or point it at the original session log.

## Choosing between similar routes

### Grill with docs or grill me?

Use `matt-grill-with-docs` when a repository exists and the decisions should leave a durable domain-language trail. Use `matt-grill-me` for plans, writing, and decisions with no repository context.

### Grilling or to-spec?

Use grilling while requirements or decisions are still unresolved. Use `matt-to-spec` once the discussion is complete and needs to become a durable implementation contract; it synthesizes rather than interviews.

### Grilling or prototype?

Use grilling while answers can be settled through decisions and facts. Detour through `matt-prototype` when the user needs to interact with behavior or compare concrete visual alternatives.

### Grill with docs or Wayfinder?

Use `matt-grill-with-docs` when the idea can be understood in one session. Use `matt-wayfinder` when unresolved decisions form a multi-session frontier and need a shared issue-tracker map.

### Wayfinder or to-tickets?

Use `matt-wayfinder` when the route is still foggy and decisions remain. Use `matt-to-tickets` when the destination is already specified and only implementation slicing remains.

### After Wayfinder reaches its destination

When the map's destination is an implementation, hand the resolved decisions to `/skill:matt-to-spec` for a durable contract, then use `/skill:matt-to-tickets` if the work is too large for one implementation session, and execute those tickets per session with `/skill:matt-implement` or as one orchestrated graph with `/skill:matt-implement-spec`. For a small spec, skip ticket-splitting and implement it directly.

### To-spec or to-tickets?

Use `matt-to-spec` to preserve the complete product and technical contract. Then use `matt-to-tickets` when the work is too large for one implementation session; for small work, implement directly from the spec.

### Implement or implement-spec?

Use `matt-implement` for one ticket/small spec or when the user wants to drive tickets individually. Use `matt-implement-spec` when a spec already has a dependency graph and the user wants coordinated parallel delivery onto an integration branch. Parallelism is bounded by ready tickets, file overlap, and runner capacity.

### After a bug fix

Offer `matt-retro` to ask what environment/check changes would have prevented the bug. Offer `matt-improve-codebase-architecture` separately when the finding is a missing seam; there is no automatic architecture handoff.

### Triage or to-tickets?

Use `matt-triage` only for raw incoming reports and requests that need evaluation. Tickets created by `matt-to-tickets` are already agent-ready and should not be triaged.

### Codebase design or architecture improvement?

Use `matt-improve-codebase-architecture` to survey the codebase and choose a candidate. Use `matt-codebase-design` when a specific module or seam is already known and the problem is designing its shape.

## Upstream routes outside this installation

`diagnosing-bugs` and `wizard` are not installed here. State that when those upstream workflows are requested rather than inventing an installed command. `resolving-merge-conflicts` was removed upstream; handle an in-progress merge/rebase using the ordinary Git workflow, without an automatic abort.
