# Worktree Creation Policy

Read alongside [the shared policy](policy.md) when creating and initializing a worktree.

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

## Base selection

For a new branch, choose its base in this order:

1. A base explicitly supplied by the user.
2. The canonical remote's default branch, when it can be determined reliably.
3. An unambiguous conventional default branch such as `main` or `master`.
4. Ask the user.

Do not silently use the current feature branch merely because it is checked out. Fetching current remote metadata is acceptable when it is needed to establish the requested base or existing PR branch; report meaningful fetch failures.

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
