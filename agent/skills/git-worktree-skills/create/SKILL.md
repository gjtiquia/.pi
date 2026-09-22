---
name: git-worktree-create
description: Create and initialize a Git worktree for parallel work on a task, issue, branch, or pull request. Use when the user wants a separate checkout and branch, especially before starting another Pi session.
---

# Create a Git Worktree

Read [the shared policy](../references/policy.md) completely before acting.

Interpret arguments or the user's request as a task description, issue/ticket, pull request, existing branch, or explicit base/branch/path. Ask only for information that cannot be discovered safely.

## Workflow

### 1. Inspect the repository

Establish:

- repository root and common Git directory;
- canonical remote and remote default branch;
- existing worktrees and checked-out branches;
- repository branch naming conventions;
- whether the request refers to an existing local branch, remote branch, or PR;
- project initialization instructions, beginning with the README and then following the policy's precedence.

Run read-only checks first. If the request identifies a PR and `gh` is installed and authenticated for this repository, inspect the PR to obtain its head repository, head branch, base branch, number, and state. Do not assume a same-repository PR; fork PRs need deliberate handling.

### 2. Choose the worktree plan

Determine and validate:

- operation: create a new branch, or check out an existing branch/PR;
- base revision for a new branch;
- local branch name;
- destination under `~/worktrees/<repository-key>/<task-key>`;
- initialization steps.

Use the shared naming and base rules. Never attach one branch to two worktrees. Check both the destination path and all registered worktrees before creating anything.

If a material choice remains inferred or ambiguous, present a compact plan and ask for confirmation. If the user already supplied an unambiguous branch, base, and intent, do not ask them to repeat the request.

A useful plan format is:

```text
Repository:  acme/widget
Operation:   new branch
Base:        origin/main
Branch:      issue-1234-fix-token-refresh
Destination: /home/user/worktrees/acme-widget/1234-fix-token-refresh
Setup:       pnpm install
```

### 3. Create the worktree

Use the appropriate normal Git form:

```bash
git worktree add -b '<new-branch>' '<destination>' '<base>'
git worktree add '<destination>' '<existing-local-branch>'
git worktree add --track -b '<local-branch>' '<destination>' '<remote>/<remote-branch>'
```

These are patterns, not commands to run blindly. For PRs, fetch the exact head ref when necessary and avoid overwriting an existing local branch. Do not use `--force` to bypass collisions.

After creation, verify that Git registered the expected absolute path, branch, and HEAD.

### 4. Initialize the checkout

Run documented, worktree-local setup from the new worktree. Typical examples include dependency installation or generated-code setup, but repository instructions control. Follow the shared restrictions for secrets, migrations, services, and global changes.

After setup, inspect `git status` and distinguish pre-existing/generated setup changes from a clean checkout. Do not silently discard setup changes.

If setup fails, stop and report the failure while leaving the worktree available for inspection.

### 5. Report

Report:

- absolute worktree path;
- branch and HEAD;
- chosen base or source branch;
- initialization commands run and their result;
- final clean/dirty status;
- any remaining manual setup.

End with the exact copyable command:

```bash
cd '<absolute-worktree-path>' && pi
```
