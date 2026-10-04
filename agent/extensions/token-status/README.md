# Token status

Global, read-only `token_status` tool for agents in local, remote, and subagent sessions. No parameters; no compaction, model changes, or network requests. Each call reads its own current session context.

Returns matching JSON text and structured data:

- `model`: active provider/ID, or `null`.
- `context`: estimated occupied `tokens`, effective `contextWindow`, `percent`, and `remainingTokens` (window minus occupancy, clamped to zero). Unknown figures are `null`, including occupancy after compaction until Pi has a new estimate. Remaining context capacity is **not** a maximum-output allowance or a guarantee that the next request fits; the tool result and subsequent messages also consume context.
- `sessionUsage`: cumulative recorded input/output/cache-read/cache-write tokens, `estimatedCostUsd`, and latest assistant prompt's `latestCacheHitPercent` (0–100, or `null`). Totals cover **all recorded session entries**, including entries off the current branch, compactions, branch summaries, and recorded nested-tool usage—not just the active context. Costs reflect Pi's recorded pricing, not a billing balance. Unrecorded usage cannot be included.

The tool shares its usage calculation with `!token status` in `../remote-mode/shared/hosted/token-commands.ts`; the remote command's compact display remains unchanged. Remote mode does not need to be enabled. The shared remote-command directory stays self-contained for downstream copies.

Check before a large investigation, after substantial tool output, or before preparing a handoff—not every turn. Cumulative spend is not remaining context budget. The tool deliberately does not impose automatic thresholds or session-control policy.

Pi discovers this directory's `index.ts` on startup/reload. Existing sessions need `/reload` (or `!reload this` remotely) to expose the new tool.

Focused tests from the repository root, using the installed Pi runtime and existing test runner:

```sh
NODE_PATH="$HOME/.pi/agent/install/releases/$(< "$HOME/.pi/agent/install/current-version")/node_modules" \
  agent/extensions/remote-mode/node_modules/.bin/tsx --test \
  agent/extensions/token-status/index.test.ts \
  agent/extensions/remote-mode/shared/dispatcher.test.ts
```

`NODE_PATH` selects the current managed Pi release's dependencies; no separate dependency install is needed.
