---
name: personal-coding-conventions
description: Apply GJ's coding preferences when implementing, refactoring, or reviewing code.
---

# Personal coding conventions

Optimize for reviewability: understand intent at the call site without opening every helper. Apply these preferences within the requested scope and the repository's explicit constraints.

For Go code, read [references/go.md](references/go.md).

- **Intent in names.** Identify the data, source, and purpose. `hasNextPage` says more than `more`. Make boolean conditions recognizable with `is`, `has`, or similar wording; keep short names when context already suffices (`flags.Verbose`, not `flags.IsVerboseEnabled`).
- **Visible effects and failures.** Names and interfaces should expose significant mutations and I/O. Distinguish helpers that return failures from orchestration that deliberately applies fallback policy. A lookup-shaped name should not conceal persistent writes.
- **Reading flow.** Put public/high-level operations generally before private details. Keep related types and helpers together when that reads better than strict top-down ordering. Separate logical steps with blank lines; expand dense expressions when it helps scanning.
- **Shared behavior.** Consolidate logic that must stay synchronized behind an honestly named interface. Prefer a small amount of obvious repetition over abstractions that obscure the flow. Simplicity beats mechanical rule-following.
- **Whole-scope passes.** When asked for a naming, simplicity, or duplication pass, inspect the entire requested scope through that lens. The cited example is a starting point, not the whole assignment. Change concrete problems; preserve already-clear code.

Before finishing, read the high-level call sites without opening their helpers. Can the reader identify each operation's purpose, significant effects, and failure/fallback path? Fix remaining surprises within scope.
