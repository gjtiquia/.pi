---
name: git-worktree-remove
description: Safely remove a Git worktree after resolving it by path, branch, issue, or pull request, while protecting uncommitted work and retaining branches. Use when a parallel checkout is no longer needed.
---

# Remove a Git Worktree

Read [the shared policy](../references/policy.md) completely before acting.

Removing a worktree deletes its checkout directory. Resolve and inspect the target before asking for final confirmation. This skill removes the worktree only; branch and remote cleanup are separate actions.

## Workflow

### 1. Resolve exactly one target

Accept an absolute or relative path, branch name, issue/ticket identifier, PR number, or descriptive task key. Compare the request with `git worktree list --porcelain` and, when useful and available, GitHub PR metadata.

Require an exact, unambiguous match. If there are multiple candidates, list them and ask the user to choose. Never select the first fuzzy match.

Do not remove:

- the repository's main checkout through this workflow;
- the worktree containing the current Pi session's working directory;
- an unregistered directory merely because its name resembles a worktree.

If the current session is inside the target, tell the user to invoke removal from the main checkout or another worktree/session.

### 2. Inspect safety and lifecycle state

Before mutation, collect and show:

- absolute target path;
- branch or detached HEAD and current commit;
- complete status, including staged, unstaged, conflicted, and untracked files;
- lock state;
- associated PR and its open/draft/merged/closed state when discoverable;
- whether the branch has an upstream and whether commits appear unpushed.

PR and ancestry information provides context, not permission. A worktree may be intentionally removed before its branch is merged, while a merged PR may still contain valuable local or untracked files.

If the worktree is dirty, locked, inaccessible, or Git would require `--force`, stop and explain the exact condition. Do not force removal unless the user explicitly authorizes it after seeing the risk. Prefer helping the user preserve work over bypassing Git's checks.

### 3. Confirm the destructive action

Immediately before removal, show a concise plan and ask for confirmation unless the user's latest message already explicitly confirms removal of the fully resolved absolute path after seeing the safety report.

Use wording similar to:

```text
Remove this checkout directory?
  Path:   /home/user/worktrees/acme-widget/1234-fix-token-refresh
  Branch: issue-1234-fix-token-refresh (retained)
  Status: clean
  PR:     #418 merged
```

Make clear that the local branch will remain.

### 4. Remove and verify

Use normal Git removal without force:

```bash
git worktree remove '<absolute-worktree-path>'
```

Then verify both that:

- the path is absent as expected;
- the worktree no longer appears in `git worktree list --porcelain`.

Do not run `git worktree prune` automatically. Pruning can affect administrative entries for other worktrees. Mention it separately only if stale entries remain, and run it only when the user requests or confirms that broader cleanup.

### 5. Report retained state

Report the removed absolute path and explicitly state that the local branch and any remote branch were retained. If a branch now appears eligible for deletion, offer that as a separate action without performing it.

If removal fails, report Git's error and the observed post-failure state. Do not claim partial cleanup succeeded without verification.
