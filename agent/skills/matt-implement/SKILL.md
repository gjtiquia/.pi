---
name: matt-implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
license: MIT (see LICENSE)
metadata:
  upstream-repository: https://github.com/mattpocock/skills
  upstream-commit: c55ee46073ed923f86ce59a5eb3b6d895095d1b7
  upstream-path: skills/engineering/implement
  adaptation: Pi-compatible matt-* naming
---

Implement the work described by the user in the spec or tickets.

Before exploring or editing, capture `git rev-parse HEAD` as the review baseline, record `git status --short`, and inventory starting untracked paths with `git ls-files --others --exclude-standard -z`. Keep this snapshot available for the final review: exclude pre-existing untracked paths from the implementation's list, and disclose any pre-existing tracked modifications as scope overlap (the baseline diff may not isolate their hunks from this work).

For tracked work, read the project's `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`, plus the [state lifecycle](../matt-triage/SKILL.md#roles) and [priority policy](../matt-triage/SKILL.md#priority-extension). Before implementation starts, fetch each issue actually being worked on, replace its readiness label with the mapped `in-progress` label, preserve its category and existing priority, and verify the transition before proceeding. If the tracker update fails or cannot be verified, report the blocker instead of claiming the issue was started. If a priority is missing, recommend one and obtain direction before applying it; ask before changing conflicting states/priorities or working on a closed issue. Do not mark an entire parent or sibling backlog in progress merely because one ticket starts. For file-based tickets, update the corresponding status/priority fields. If tracker configuration is missing, ask for setup rather than guessing labels.

Load and follow `matt-tdd` where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Before committing, load and follow `matt-code-review` with the explicit **working-tree scope from the captured baseline**. Include committed changes since that baseline, all staged and unstaged tracked changes, and the untracked files created by this implementation; inventory untracked paths again, exclude the starting inventory, and provide the reviewer the explicit implementation-file list so unrelated untracked files are excluded.

Dispose of every material finding by fixing it or getting the user's explicit decision to retain it. If a finding leads to a code or review-input change, rerun affected tests/typechecks and both review axes against the updated, frozen working-tree scope. Commit only when no material finding remains undisposed.

Commit your work to the current branch.

At handoff, re-read the worked issues and apply the state lifecycle above: retain `in-progress` for open issues, clean it up for closed issues, or restore readiness if the work is explicitly abandoned/released. Verify any transition and report the observed issue state; this handoff does not authorize closing an issue or merging a PR.
