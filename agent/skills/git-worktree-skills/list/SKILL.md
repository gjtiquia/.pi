---
name: git-worktree-list
description: List and summarize a repository's Git worktrees, including paths, branches, dirty state, locked or prunable status, and associated pull requests when discoverable. Use when reviewing parallel work or deciding what can be removed.
---

# List Git Worktrees

Read [the shared policy](../references/policy.md) completely before acting.

This is a read-only workflow. Do not prune, fetch, remove, repair, or otherwise mutate worktrees while listing them.

## Workflow

### 1. Identify the repository

Resolve the current repository's common Git directory. The skill may be invoked from the main checkout or any linked worktree. If the current directory is not in a Git repository, ask which repository to inspect.

### 2. Collect Git worktree facts

Use `git worktree list --porcelain` as the authoritative inventory. Preserve paths containing spaces and recognize:

- main checkout versus linked worktrees;
- branch name or detached HEAD;
- HEAD commit;
- locked worktrees and lock reasons;
- prunable administrative entries and prune reasons.

For each accessible worktree, inspect status from that worktree without changing it. Include tracked modifications, staged changes, conflicts, and untracked files in the clean/dirty classification. If a path is missing or inaccessible, say so instead of treating it as clean.

### 3. Enrich with pull-request state

When the repository is hosted on GitHub and `gh` is installed and authenticated, correlate branch names with pull requests. Prefer a bounded repository-level query over one network request per worktree when practical. Report:

- PR number and title;
- URL;
- draft/open/merged/closed state;
- whether a closed PR was not merged.

Do not equate Git ancestry with PR state, especially for squash or rebase merges. If forge metadata is unavailable, show `PR: unknown` or omit the field with a short explanation; do not fail the local listing.

### 4. Present a compact summary

Show one clearly separated entry or table row per worktree with:

- role: main or linked;
- absolute path;
- branch or detached state;
- abbreviated HEAD;
- clean/dirty/inaccessible status;
- locked or prunable state;
- associated PR state when known.

Use labels such as `MAIN`, `OPEN`, `MERGED`, `CLOSED`, and `LOCAL` only when supported by the collected facts. Never label a worktree safe to remove solely because its branch appears merged.

End with a short summary count, for example:

```text
4 worktrees: 1 main, 2 open PRs, 1 merged PR; 1 dirty.
```

If any worktrees look like cleanup candidates, identify them as candidates rather than removing them or asserting they are safe.
