---
name: personal-coding-conventions
description: Apply GJ's coding preferences when implementing, refactoring, or reviewing code, and when writing Markdown.
---

# Personal coding conventions

Optimize for reviewability: understand intent at the call site without opening every helper.
Apply these preferences within the requested scope and the repository's explicit constraints.

When adding or revising a convention, state the decision that carries across projects.
Use the smallest concrete example that makes the distinction clear.
Keep project-specific advice in that project's docs.

## References

- Read [Go conventions](references/go.md) when working on Go code.
- Read [TypeScript conventions](references/typescript.md) when working on TypeScript code.
- Read [Markdown conventions](references/markdown.md) when working on Markdown.

## Design and placement

- Preserve adjacent workflows
  - Keep existing commands, defaults, and feedback loops outside the requested scope.
  - For example, adding one service to a local stack should preserve how contributors start and reload another service.
  - If an adjacent workflow must change, explain why before editing.

- Simplicity > Complexity
  - Prefer the simplest design that meets current requirements.
  - Choose straightforward control flow and concrete implementations.
  - Introduce abstraction, indirection, or configuration when it clarifies the code or satisfies a demonstrated requirement.

- Framework and library defaults
  - Start with the defaults.
  - When they fall short, prefer supported configuration or extension points over workarounds you'll have to maintain across upgrades.
  - When behavior depends on a non-obvious framework convention,
    explain it briefly where the reader encounters it and link to the relevant official docs.

- File length is a review signal, not a limit
  - Around 500 lines in a source file is a warning to check cohesion. At 1,000 lines or more, look closely for responsibilities that change independently.
  - Split where the boundary makes code easier to find and change. A parser and a formatter may deserve separate files; one cohesive grammar can stay together.

- Directory layout
  - Keep framework entry points where the framework expects them.
  - Group the behavior they call by feature, and keep small, cohesive directories flat.
  - A directory listing should show where to start, which files belong to the task, and where the next similar feature would go.

- [Locality of behavior](https://htmx.org/essays/locality-of-behaviour/)
  - Keep triggers, guards, and the order of operations visible where the behavior is invoked or declared.
  - For example, declare a button's action on the button rather than wiring it up by ID in another file.
  - Keep caller-specific decisions about retries, fallbacks, and error handling next to the call they govern.
  - For example, let a fetch helper return an error and let the caller decide whether to serve cached data.
  - When distinct features produce the same kind of result, keep their purposes visible at the call site.
  - A shared return type alone isn’t a reason to group them.
  - Keep a small, single-use rule with its caller when reading them together is clearer than navigating to a helper.
  - Extract implementation details, and centralize policy when it must apply consistently across callers.

- Prevent behavioral drift
  - Ask: would changing one caller's behavior without changing the other's be a bug?
  - When callers make the same decision for the same reason, share the rule behind an interface that names the decision.
    For example, indexing and ranking can use the same `isSearchable` rule.
  - When components do different jobs but must agree on the result, test their agreement.
    For example, test that a reader restores a default value omitted by a writer.
  - Keep similar code separate when the behaviors can change independently.
    Prefer a small amount of obvious repetition over an abstraction that obscures the flow.

- Likely adjustments
  - Put values meant to be tuned by hand in named constants near the top of the file that owns the behavior.
  - Group related values and aim for a one-place edit.
  - Test behavior without pinning valid defaults unless the exact value is a requirement.

## Names and reading flow

- Findability
  - Name files, directories, types, and functions for the concept and role a reader will search for.
  - Use the same established term across related names,
    and group related material so directory listings and search results reveal where to start and what belongs together.
  - Prefer specific, conventional names over clever abbreviations or generic labels;
    add a short qualifier when it distinguishes neighboring concepts.

- Move code before rewriting it
  - When extracting or relocating code, keep existing names and comments unless the move makes them inaccurate.
  - Leave unrelated cleanup out of the diff.

- Intent in names
  - Start a review with names: do they convey the operation at a glance?
  - Use one term per concept across commands, directories, and functions.
  - Identify the data, source, and purpose. `hasNextPage` says more than `more`.
  - When a name could suggest the wrong kind of value, choose a noun that hints at how to use it:
    `legacyLinkResponse` can be returned directly; `routeDecision` suggests branching.
  - Prefer a `try` prefix when returning no result is an expected outcome.
  - Use `is`, `has`, or similar wording for booleans when it clarifies the condition.
  - Keep short names when context suffices (`flags.Verbose`, not `flags.IsVerboseEnabled`).

- Visible effects and failures
  - Names and interfaces should expose significant mutations and I/O.
  - Distinguish helpers that return failures from orchestration that deliberately applies fallback policy.
  - A lookup-shaped name should not conceal persistent writes.

- Reading flow
  - Generally put public or high-level operations before private details.
  - Keep related types and helpers together when that reads better than strict top-down ordering.
  - Expand dense expressions when it helps scanning.
  - When `return helper(...)` hides a meaningful before-and-after distinction, name the result before returning it.
  - Keep the direct return when the variable would only repeat the call.
  - When a result determines whether another step runs, name the result and show the decision with an explicit branch.
  - Give distinct results distinct names rather than reassigning one variable.

- Blank lines mark a change of thought
  - Keep declarations about the same concept together;
    leave a blank line when the subject changes.
  - In a function or test, do the same between distinct steps.
  - Keep a lookup and its guard together.
  - After an early return, leave a blank line before the next distinct step.
  - One blank line often communicates the boundary without a heading or comment.

- Line breaks in code comments
  - Keep a sentence on one source line by default. Two short sentences can share a line if they express one thought.
  - Start a new line when the thought changes, even if there is room left.
  - Treat 132 characters as a guideline, not a limit or a width to fill.
  - If a sentence needs a break, split after punctuation at a natural pause. If there is no such pause, keep the longer line.

- Existing conventions
  - Match the surrounding code or document's style unless changing that convention is part of the task.

## Review checks

- Test the distinction
  - Ask what broken behavior could still pass the test and what valid change could make it fail.
  - For example, test a filter with both a matching item and a nonmatching item.
  - Checking only that the nonmatch disappeared would also pass if the filter returned nothing.
  - If order is irrelevant, assert which items remain, not their order.

- Preserve the benefit a test protects
  - Before replacing a test that no longer matches the implementation,
    name what the user would lose if the test disappeared.
  - Keep an equivalent check, or measure and explicitly accept the tradeoff.
  - For performance changes, compare cold and warm visits separately.
  - Time to usable input and time to useful results can differ.

- Keep tests and docs stable under unrelated changes
  - In tests, wait for the observable outcome rather than guessing a delay.
  - Assert exact text, counts, or order only when they are part of the behavior under test.
  - In docs, explain the workflow and how to run it.
  - Prefer the suite command over an inventory of test names or cases.
  - Adding a case or renaming a test should not require a README edit unless the reader's workflow changes.

- Whole-scope passes
  - For a naming, simplicity, or duplication pass, inspect the entire requested scope.
  - Treat the cited example as a starting point, not the whole assignment.
  - Fix concrete problems and preserve already-clear code.

- Before finishing
  - Read the high-level call sites without opening their helpers.
  - Can you identify each operation's purpose, significant effects, and failure or fallback path?
  - Fix remaining surprises within scope.
