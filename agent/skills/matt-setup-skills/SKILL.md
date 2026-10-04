---
name: matt-setup-skills
description: "Configure a repo for the Matt Pocock-derived engineering skills, or migrate its legacy domain docs to the glossary convention."
disable-model-invocation: true
license: MIT (see LICENSE)
metadata:
  upstream-repository: https://github.com/mattpocock/skills
  upstream-commit: 24fe0ef7737efae15c87225755e9f6f5965e4888
  upstream-path: skills/engineering/setup-matt-pocock-skills
  adaptation: Pi-compatible matt-* naming
---

# Setup Matt Pocock-Derived Skills

Scaffold the per-repo configuration that the engineering skills assume:

- **Issue tracker**: where issues live (GitHub by default; local markdown is also supported out of the box)
- **Triage labels**: the strings used for category, state (including `in-progress`), and priority roles
- **Domain docs**: where `GLOSSARY.md` and ADRs live, and the consumer rules for reading them

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config`: is this a GitHub repo? Which one?
- `AGENTS.md` at the repo root: does it exist? Is there already an `## Agent skills` section?
- `GLOSSARY.md` and `GLOSSARY-MAP.md`, plus legacy `CONTEXT.md` and `CONTEXT-MAP.md`, at the repo root and at locations selected by existing domain-doc pointers or maps. Read [the glossary discovery policy](../matt-domain-modeling/GLOSSARY-COMPATIBILITY.md) for legacy fallback and collisions.
- `docs/adr/` and any `src/*/docs/adr/` directories
- Existing agent-doc pointers and their targets, including `docs/agents/`: does prior setup output already exist? Preserve configured locations rather than moving them to template defaults.
- `.scratch/`: a sign that a local-markdown issue tracker convention is already in use
- Is the `matt-triage` skill installed? (a `matt-triage` skill folder alongside this one, or `matt-triage` in your available skills.) This decides whether Section B runs at all.
- Monorepo signals: a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. These are present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

If legacy files or active legacy consumer references exist, follow [Migration notes: v1.3 glossary naming](#migration-notes-v13-glossary-naming) below instead of fresh scaffolding. If setup is incomplete too, report that separately and ask whether the user wants migration only or also the missing setup sections.

### 2. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order. One section, one answer, then the next. Skip configuration already settled by the existing setup; retain custom labels and policies unless the user explicitly requests changes.

Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (Section B when `matt-triage` isn't installed, Section C when there's no monorepo).

**Section A: Issue tracker.**

> Explainer: The "issue tracker" is where issues live for this repo. Skills like `matt-to-tickets`, `matt-triage`, and `matt-to-spec` read from and write to it. They need to know whether to call `gh issue create`, write a markdown file under `.scratch/`, or follow some other workflow you describe. Pick the place you actually track work for this repo.

Default posture: these skills were designed for GitHub. If a `git remote` points at GitHub, propose that. If a `git remote` points at GitLab (`gitlab.com` or a self-hosted host), propose GitLab. Otherwise (or if the user prefers), offer:

- **GitHub**: issues live in the repo's GitHub Issues (uses the `gh` CLI)
- **GitLab**: issues live in the repo's GitLab Issues (uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI)
- **Local markdown**: issues live as files under `.scratch/<feature>/` in this repo (good for solo projects or repos without a remote)
- **Other** (Jira, Linear, etc.): ask the user to describe the workflow in one paragraph; the skill will record it as freeform prose

Record the choice in `docs/agents/issue-tracker.md`. The GitHub and GitLab templates carry a "PRs as a request surface" flag, defaulted **off**. Leave it off and don't raise it: a user who wants external PRs in the triage queue can flip the flag in the file later.

**Section B: Triage label vocabulary.** Skip this section entirely if the `matt-triage` skill isn't installed (exploration told you), since an uninstalled skill needs no labels.

If it is installed, ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are category `bug` and `enhancement`; state `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `in-progress`, and `wontfix`; and priority `P0`, `P1`, `P2`, and `P3`. Each label string equals its role name. The [triage-labels template](./triage-labels.md) defines start/closure/release transitions and the requirement for exactly one priority on every open issue, including generated and Wayfinder issues; include those rules with the mapping. Priority is independent of state. On **yes**, write them as-is. Only if the user says no, usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`), collect the overrides so `matt-triage` applies existing labels instead of creating duplicates.

**Section C: Domain docs.** Default to **single-context** (one `GLOSSARY.md` + `docs/adr/` at the repo root). This fits almost every repo; write it without asking.

Offer **multi-context** (a root `GLOSSARY-MAP.md` pointing to per-context `GLOSSARY.md` files) only when exploration found monorepo signals. Then confirm which layout they want.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to the repo's `AGENTS.md`
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `docs/agents/triage-labels.md` (the last only when `matt-triage` is installed)

Let them edit before writing.

### 4. Write

**Edit `AGENTS.md`:**

Pi uses the repo's `AGENTS.md` for project instructions. If it does not exist, confirm with the user before creating it.

If an `## Agent skills` block already exists, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout: "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Include the `### Triage labels` sub-block, and write `docs/agents/triage-labels.md`, only when `matt-triage` is installed and Section B ran. When it isn't, both are omitted.

Then write the docs files using the seed templates in this skill folder as a starting point:

- [issue-tracker-github.md](./issue-tracker-github.md): GitHub issue tracker
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md): GitLab issue tracker
- [issue-tracker-local.md](./issue-tracker-local.md): local-markdown issue tracker
- [triage-labels.md](./triage-labels.md): label mapping (only if `matt-triage` is installed)
- [domain.md](./domain.md): domain doc consumer rules + layout

For "other" issue trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description.

### 5. Done

Tell the user the setup is complete and which engineering skills will now read from these files, including `matt-to-spec`, `matt-to-tickets`, and `matt-implement-spec`. Mention they can edit the configured agent docs directly later; re-running this skill is useful for a documented migration or an intentional configuration change.

## Migration notes: v1.3 glossary naming

Run `/skill:matt-setup-skills` in a separate session for each project needing migration. This migration changes domain-doc names and active pointers, not the issue tracker or the project's workflow.

1. **Inventory.** Read existing project instructions, domain-doc consumer rules, and any root/context maps. Identify each legacy glossary/map and its proposed new path: `CONTEXT.md` → `GLOSSARY.md`, `CONTEXT-MAP.md` → `GLOSSARY-MAP.md`. Find active references in project instructions, configured agent docs, READMEs, map links, and other maintained documentation. Inspect tracked/untracked status and user modifications before proposing edits. Do not scan dependency/generated directories or rename unrelated files merely because they share the old name.
2. **Resolve collisions.** If old and new counterparts coexist, present both and ask which is authoritative. Pause the affected rename and consumer changes until resolved; never overwrite or automatically combine glossaries. Mixed migrated/unmigrated contexts are handled individually. Preserve the existing single-/multi-context layout and configured doc locations.
3. **Confirm the plan.** Show exact renames and active-reference edits, then ask before writing. Preserve tracker choice, label mappings (including project priority/area/`in-progress` extensions), verification rules, UI policies, and custom instructions. Do not regenerate existing files from seed templates. Historical review/session records may keep the old name when describing past work; update a live navigational link only when necessary, without rewriting the historical claim. If only stale active references remain, propose pointer edits without a rename.
4. **Apply only the confirmed migration.** Use `git mv` for tracked files; move untracked files only if included in the confirmed plan. Update map links and active consumer instructions to the resolved new paths. Preserve glossary content and ADRs. Do not create another glossary, publish tracker changes, commit, or push as an incidental part of migration.
5. **Verify and report.** Confirm renamed files exist, affected links resolve, maps still select the same contexts, and active consumers use the new paths. Inspect the diff for unrelated policy/content changes. Report migrated paths, unresolved collisions, and intentionally retained historical references. If already migrated with no stale active pointers, report that no changes are needed.
