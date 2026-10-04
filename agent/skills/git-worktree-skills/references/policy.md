# Git Worktree Policy

This policy is shared by the `git-worktree-create`, `git-worktree-list`, and `git-worktree-remove` skills. Read it before acting.

## Scope

These skills manage parallel checkouts for work on separate tasks and pull requests. They manage Git worktrees, not Pi sessions, pull requests, or remote branches unless the user explicitly asks for those separate actions. The creation-only Pi launch handoff is documented in [the create workflow](../create/SKILL.md); listing and removal do not require it.

Always operate on the repository associated with the current working directory unless the user names another repository. Commands must work when invoked from either the main checkout or an existing linked worktree.

## Repository discovery

Use Git plumbing rather than assuming `.git` is a directory. A linked worktree normally has a `.git` file. Useful sources include:

```bash
git rev-parse --show-toplevel
git rev-parse --git-common-dir
git worktree list --porcelain
git remote -v
```

Never reset, switch, clean, stash, or otherwise alter the user's current checkout as part of worktree management.

## Shared safety rules

Before mutation, identify the repository, worktree path, branch, and relevant commit/base. Reject path or branch collisions instead of improvising a different name.

Treat paths as potentially containing spaces and quote them in shell commands. Do not use `--force` for add or remove unless the user explicitly authorizes it after seeing why Git's normal safety check failed.

Worktree removal and branch deletion are separate operations. Removing a worktree must not implicitly delete:

- its local branch;
- its remote branch;
- its pull request.

A merged PR does not prove ancestry when the repository uses squash or rebase merges. If merge state matters, use forge metadata such as `gh pr view` when available rather than relying only on `git branch --merged`.

## Reporting

Use absolute paths in the final result. Clearly distinguish observed facts from inferred choices.
