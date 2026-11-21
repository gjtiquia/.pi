---
name: personal-coding-conventions
description: Apply GJ's coding preferences when implementing, refactoring, or reviewing code.
---

# Personal coding conventions

Optimize for reviewability: understand intent at the call site without opening every helper.
Apply these preferences within the requested scope and the repository's explicit constraints.

## References

- **Go:** Read [Go conventions](references/go.md) when working on Go code.
- **TypeScript:** Read [TypeScript conventions](references/typescript.md) when working on TypeScript code.
- **Markdown:** Read [Markdown conventions](references/markdown.md) when working on Markdown.

## Design and placement

- **Simplicity > Complexity.** Prefer the simplest design that meets current requirements.
  Choose straightforward control flow and concrete implementations.
  Introduce abstraction, indirection, or configuration when it clarifies the code
  or satisfies a demonstrated requirement.
- **Framework and library defaults.** Start with the defaults.
  When they fall short, prefer supported configuration or extension points
  over workarounds you'll have to maintain across upgrades.
- **Directory layout.** Keep framework entry points where the framework expects them.
  Group the behavior they call by feature, and keep small, cohesive directories flat.
  A directory listing should show where to start, which files belong to the task,
  and where the next similar feature would go.
- **[Locality of behavior](https://htmx.org/essays/locality-of-behaviour/).**
  Keep triggers, guards, and the order of operations visible where the behavior is invoked or declared.
  For example, declare a button's action on the button rather than wiring it up by ID in another file.
  Keep caller-specific decisions about retries, fallbacks, and error handling next to the call they govern.
  For example, let a fetch helper return an error and let the caller decide whether to serve cached data.
  When distinct features produce the same kind of result, keep their purposes visible at the call site.
  A shared return type alone isn’t a reason to group them.
  Extract implementation details, and centralize policy when it must apply consistently across callers.
- **Shared behavior.** Consolidate logic that must stay synchronized behind an honestly named interface.
  Prefer a small amount of obvious repetition over abstractions that obscure the flow.
- **Likely adjustments.** Put values meant to be tuned by hand in named constants
  near the top of the file that owns the behavior.
  Group related values and aim for a one-place edit.
  Test behavior without pinning valid defaults unless the exact value is a requirement.

## Names and reading flow

- **Intent in names.** Start a review with names: do they convey the operation at a glance?
  Use one term per concept across commands, directories, and functions.
  Identify the data, source, and purpose. `hasNextPage` says more than `more`.
  When a name could suggest the wrong kind of value, choose a noun that hints at how to use it:
  `legacyLinkResponse` can be returned directly; `routeDecision` suggests branching.
  Use `is`, `has`, or similar wording for booleans when it clarifies the condition.
  Keep short names when context suffices (`flags.Verbose`, not `flags.IsVerboseEnabled`).
- **Visible effects and failures.** Names and interfaces should expose significant mutations and I/O.
  Distinguish helpers that return failures from orchestration that deliberately applies fallback policy.
  A lookup-shaped name should not conceal persistent writes.
- **Reading flow.** Generally put public or high-level operations before private details.
  Keep related types and helpers together when that reads better than strict top-down ordering.
  Expand dense expressions when it helps scanning. When `return helper(...)` hides a meaningful
  before-and-after distinction, name the result before returning it. Keep the direct return
  when the variable would only repeat the call.
  When a result determines whether another step runs, name the result and show the decision
  with an explicit branch. Give distinct results distinct names rather than reassigning one variable.
- **Blank lines mark a change of thought.** Keep declarations about the same concept together;
  leave a blank line when the subject changes. In a function or test, do the same between
  distinct steps. One blank line often communicates the boundary without a heading or comment.
- **Existing conventions.** Match the surrounding code or document's style
  unless changing that convention is part of the task.

## Review checks

- **Whole-scope passes.** For a naming, simplicity, or duplication pass, inspect the entire requested scope.
  Treat the cited example as a starting point, not the whole assignment.
  Fix concrete problems and preserve already-clear code.
- **Before finishing.** Read the high-level call sites without opening their helpers.
  Can you identify each operation's purpose, significant effects, and failure or fallback path?
  Fix remaining surprises within scope.
