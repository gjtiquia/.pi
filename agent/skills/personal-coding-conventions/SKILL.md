---
name: personal-coding-conventions
description: Apply GJ's coding preferences when implementing, refactoring, or reviewing code.
---

# Personal coding conventions

Optimize for reviewability: understand intent at the call site without opening every helper. Apply these preferences within the requested scope and the repository's explicit constraints.

For Go code, read [references/go.md](references/go.md). For TypeScript, read [references/typescript.md](references/typescript.md). For Markdown, read [references/markdown.md](references/markdown.md).

- **Simplicity > Complexity.** Prefer the simplest design that meets current requirements. Choose straightforward control flow and concrete implementations; introduce abstraction, indirection, or configuration when it makes the code easier to understand or satisfies a demonstrated requirement.
- **Intent in names.** Start a review with names: do they convey the operation at a glance? Use one term per concept across commands, directories, and functions. Identify the data, source, and purpose. `hasNextPage` says more than `more`. Make boolean conditions recognizable with `is`, `has`, or similar wording; keep short names when context already suffices (`flags.Verbose`, not `flags.IsVerboseEnabled`).
- **Visible effects and failures.** Names and interfaces should expose significant mutations and I/O.
  Distinguish helpers that return failures from orchestration that deliberately applies fallback policy.
  A lookup-shaped name should not conceal persistent writes.
- **Prefer framework and library defaults.** Start with the defaults. When they fall short, prefer supported configuration or extension points over workarounds you’ll have to maintain across upgrades.
- **Directory layout.** Keep framework entry points where the framework expects them. Group the behavior they call by feature. A directory listing should show where to start and which files belong to that task. Make the layout a pattern humans and agents can follow: someone adding the next similar feature should know where it belongs. Keep a small, cohesive directory flat.
- **[Locality of behavior](https://htmx.org/essays/locality-of-behaviour/).**
  Keep triggers, guards, and the order of operations visible where the behavior is invoked or declared.
  For example, declare a button's action on the button rather than wiring it up by ID in another file.
  Keep caller-specific decisions about retries, fallbacks, and error handling next to the call they govern.
  For example, let a fetch helper return an error and let the caller decide whether to serve cached data.
  Extract implementation details, and centralize policy when it must apply consistently across callers.
- **Preserve existing conventions.** Match the surrounding code or document’s style unless changing that convention is part of the task.
- **Reading flow.** Put public/high-level operations generally before private details. Keep related types and helpers together when that reads better than strict top-down ordering. Separate logical steps with blank lines; expand dense expressions when it helps scanning.
- **Shared behavior.** Consolidate logic that must stay synchronized behind an honestly named interface. Prefer a small amount of obvious repetition over abstractions that obscure the flow.
- **Make likely adjustments easy.** When a value is meant to be tuned by hand, prefer a named constant near the top of the file that owns the behavior. Keep related values together when that makes the adjustment easier to find. Aim for a one-place edit: tests should catch broken behavior, not fail just because a valid default changed. If the exact value is a requirement, test it explicitly.
- **Whole-scope passes.** When asked for a naming, simplicity, or duplication pass, inspect the entire requested scope through that lens. The cited example is a starting point, not the whole assignment. Change concrete problems; preserve already-clear code.

Before finishing, read the high-level call sites without opening their helpers.
Can the reader identify each operation's purpose, significant effects, and failure/fallback path?
Fix remaining surprises within scope.
