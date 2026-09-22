---
name: github-cli
description: Operate on GitHub issues and pull requests with the gh CLI, including reading and listing items, diffs and checks, creating and updating issues, comments, labels, assignments, dependencies, sub-issues, and inspecting attached screenshots. Use whenever GitHub issue or PR information must be retrieved or changed.
compatibility: Requires git and an authenticated GitHub CLI (gh). Screenshot inspection requires an image-capable read or browser tool.
---

# GitHub CLI

Use `gh` as the GitHub adapter. Keep workflow policy in the calling skill: this skill supplies GitHub mechanics, not triage states, approval rules, ticket formats, or project-specific labels.

## Route the operation

- Read, list, diff, check, create, edit, comment, label, assign, or close an issue or PR: read [references/items.md](references/items.md).
- Read or change sub-issues and blocking relationships: read [references/relationships.md](references/relationships.md).
- Inspect images attached to an issue, PR, review, or comment: read [references/screenshots.md](references/screenshots.md) in addition to the item recipe.

Read only the references needed for the current operation.

## Invariants

1. Check authentication before the first operation:

   ```bash
   gh auth status
   ```

   Inside a checkout, discover its repository with `gh repo view --json nameWithOwner,url`. Outside a checkout, derive the repository from the supplied GitHub URL or require `OWNER/REPO`; do not run `gh repo view` without a repository context.
2. Resolve the repository once and pass `--repo OWNER/REPO` (or `-R`) to every `gh issue` and `gh pr` command. Do not rely on the current directory after resolution. For URLs and cross-repository references, derive the repository from the reference rather than the checkout.
3. Prefer `--json` and documented JSON fields. Do not scrape human-oriented terminal output.
4. GitHub issues and PRs share a number space. A URL identifies the kind. For a bare `#N` or number, try `gh pr view` first and fall back to `gh issue view`; report the resolved kind.
5. Read the current item before changing it. After a mutation, fetch the affected fields again and report the resulting state and URL.
6. Put multiline Markdown in a temporary file and use `--body-file`; do not fight shell quoting. Remove temporary files when finished.
7. Treat create, comment, edit, label, assign, relationship, close, merge, and review operations as externally visible writes. Follow the calling workflow's approval requirements. Never silently convert a read request into a write.
8. Never print, log, or interpolate authentication tokens into commands. Prefer `gh`, which manages authentication itself. Use an authenticated browser for private attachment URLs that ordinary fetching cannot access.
9. Preserve user-authored Markdown exactly unless the requested operation requires changing it. For body edits, fetch the latest body immediately before replacement to reduce accidental overwrites.
10. Paginate collection API requests when completeness matters.
