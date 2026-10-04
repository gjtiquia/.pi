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

Load and follow `matt-tdd` where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Before committing, load and follow `matt-code-review` with the explicit **working-tree scope from the captured baseline**. Include committed changes since that baseline, all staged and unstaged tracked changes, and the untracked files created by this implementation; inventory untracked paths again, exclude the starting inventory, and provide the reviewer the explicit implementation-file list so unrelated untracked files are excluded.

Dispose of every material finding by fixing it or getting the user's explicit decision to retain it. If a finding leads to a code or review-input change, rerun affected tests/typechecks and both review axes against the updated, frozen working-tree scope. Commit only when no material finding remains undisposed.

Commit your work to the current branch.
