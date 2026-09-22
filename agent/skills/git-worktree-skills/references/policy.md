# Git Worktree Policy

This policy is shared by the `git-worktree-create`, `git-worktree-list`, and `git-worktree-remove` skills. Read it before acting.

## Scope

These skills manage parallel checkouts for work on separate tasks and pull requests. They manage Git worktrees, not Pi sessions, pull requests, or remote branches unless the user explicitly asks for those separate actions.

Always operate on the repository associated with the current working directory unless the user names another repository. Commands must work when invoked from either the main checkout or an existing linked worktree.

## Location convention

Create linked worktrees under:

```text
~/worktrees/<repository-key>/<task-key>
```

Derive `<repository-key>` from the canonical repository remote, preferring `origin`:

1. Use the remote owner and repository names, normalized as `<owner>-<repository>`.
2. Strip protocol, host, credentials, trailing `.git`, and unsafe path characters.
3. If no usable remote exists, use the repository root directory name.

Examples:

```text
~/worktrees/acme-widget/1234-fix-token-refresh
~/worktrees/acme-widget/pr-418-review-token-refresh
~/worktrees/widget/improve-error-messages
```

Choose a short, stable, lowercase kebab-case `<task-key>`. Prefer:

1. Issue or ticket identifier plus description.
2. PR number plus description when working on an existing PR.
3. Description alone.

Do not add a date. Do not rename an existing worktree merely because a PR number becomes available later.

The filesystem task key and Git branch name are related identifiers, but they do not have to be identical. Follow an established branch naming convention when the repository has one.

## Repository and base discovery

Use Git plumbing rather than assuming `.git` is a directory. A linked worktree normally has a `.git` file. Useful sources include:

```bash
git rev-parse --show-toplevel
git rev-parse --git-common-dir
git worktree list --porcelain
git remote -v
```

For a new branch, choose its base in this order:

1. A base explicitly supplied by the user.
2. The canonical remote's default branch, when it can be determined reliably.
3. An unambiguous conventional default branch such as `main` or `master`.
4. Ask the user.

Do not silently use the current feature branch merely because it is checked out. Fetching current remote metadata is acceptable when it is needed to establish the requested base or existing PR branch; report meaningful fetch failures.

Never reset, switch, clean, stash, or otherwise alter the user's current checkout as part of worktree management.

## Initialization discovery

A successful `git worktree add` only creates a checkout. Determine whether the project requires initialization.

Use this precedence:

1. Explicit worktree-specific instructions in repository documentation.
2. A documented repository bootstrap/setup command or script.
3. `README.md` as the normal starting point, followed by relevant `AGENTS.md`, `CONTRIBUTING.md`, developer docs, `Makefile`, `justfile`, and package-manager scripts.
4. Conservative inference from ecosystem manifests and lockfiles.
5. Ask when more than one credible setup exists or the operation has material side effects.

Respect the repository's selected package manager and lockfile. Do not generate a competing lockfile.

Do not automatically:

- copy, print, or expose secrets;
- copy or symlink ignored environment files unless repository instructions explicitly require it or the user confirms;
- run database migrations, seed shared services, start long-running services, or make global machine changes;
- invent a setup process when documentation is ambiguous.

If initialization fails, preserve the newly created worktree, explain exactly what succeeded and failed, and offer removal. Do not automatically destroy it.

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

After creation, always print a copyable command for starting a separate Pi session:

```bash
cd '<absolute-worktree-path>' && pi
```

A `cd` executed by an agent shell does not change the user's terminal or rebind the current Pi session. Do not claim that the current Pi session moved to the new worktree.
