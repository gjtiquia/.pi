---
name: matt-implement-spec
description: "Implement a ticketed spec as a task graph on one integration branch."
disable-model-invocation: true
license: MIT (see LICENSE)
metadata:
  upstream-repository: https://github.com/mattpocock/skills
  upstream-commit: 24fe0ef7737efae15c87225755e9f6f5965e4888
  upstream-path: skills/engineering/implement-spec
  adaptation: Pi task-graph orchestration with bounded delegation, safe worktrees, verified issue lifecycle, and frozen review scopes
---

Implement the supplied spec and its tickets on one **integration branch**. Tickets form a **task graph**; schedule its ready **frontier**, rather than treating the tickets as a sequential checklist. Prefer context pointers to copies of existing specs, tickets, research, and commits.

This is an orchestrator, not permission to merge into the default branch, reset existing work, publish a PR, close issues, or remove worktrees. Honor the user's authorization and project policies for those actions.

## 1. Establish the graph and execution contract

Read the project's `AGENTS.md`, its issue-tracker and triage-label pointers, and its verification instructions. If tracker configuration is missing, tell the user to run `/skill:matt-setup-skills` and stop rather than defaulting to GitHub. For GitHub operations, read and follow [github-cli](../github-cli/SKILL.md). Read [the glossary discovery policy](../matt-domain-modeling/GLOSSARY-COMPATIBILITY.md), then the resolved glossary and relevant ADRs.

Fetch the spec, tickets, acceptance criteria, blocking edges, and current states. Confirm the graph is acyclic and each required ticket exists; report missing/cyclic dependencies or external blockers before scheduling. If no tickets exist, ask the user to run `/skill:matt-to-tickets` rather than inventing a graph. Already-completed tickets must be verified against the intended integration base; a closed ticket whose implementation is absent is a blocker, not silently satisfied.

Capture the source repository, base commit, `git status --short`, and starting untracked inventory (`git ls-files --others --exclude-standard -z`). Keep pre-existing work outside this build; disclose overlap and ask before incorporating it. Agree the integration branch/base, pre-agreed test seams, concurrency bound, and required publishing/closure permissions. Dependency readiness, overlapping files, and runner capacity can further reduce concurrency. Resolve only the tickets actually completed; a partial or blocked run remains partial.

If exploration would independently unblock implementers, delegate that narrower task once. Ask for cited notes at a disclosed, non-secret absolute path accessible to all worktrees; this is a context pointer, not another implementation assignment.

## 2. Prepare owned worktrees

Read [git-worktree-create](../git-worktree-skills/create/SKILL.md) and its required policies. Create an owned integration checkout/branch from the agreed base, then an owned branch/worktree for each scheduled ticket from the current integration tip. Initialize each checkout using project instructions and inspect setup changes. Never attach one branch to multiple checkouts or overwrite an existing branch/path.

Record each absolute path, branch, and base SHA. Before dispatch, verify the ticket worktree contains that integration tip in its ancestry. If based incorrectly, stop and correct the plan with the user; use a fresh correctly based worktree rather than resetting existing work. Keep the source checkout untouched.

## 3. Dispatch the ready frontier

Use Pi `subagent` calls in parallel for independent ready tickets (for example, awaited calls in one `codemode` batch). The tool returns when a child finishes; there is no detached/background-agent mode. If other siblings are still running, keep their original calls awaited while scheduling newly unblocked work within the bound. When streaming completion is impractical, use bounded waves and recompute the frontier after each wave. Never abandon an in-flight tool call to simulate background execution.

Before every dispatch, state the bounded outcome and stopping condition. Default implementers and scoped exploration to `modelTier: "balanced"`; use `modelTier: "deep"` for substantive reviewer assignments, including both Standards and Spec axes, unless the user explicitly overrides the selection. Deliberately choose `stallTimeoutSeconds` for the longest legitimate silent build/check. A child inherits the parent's cwd, not the ticket worktree: give it the absolute checkout path and require explicit command cwd / `git -C` there, plus explicit reads of that checkout's project instructions. A shell `cd` does not rebind Pi.

Each implementer receives:

- One ticket and the spec/acceptance-criteria pointers, blocking commits, absolute worktree path/branch/base, expected file surface, confirmed seams, and glossary/ADR pointers.
- Its verification ownership: focused checks for its ticket, with the parent owning integrated checks. Follow the project's execution/evidence rules; heavy E2E/builds use `remote_run` only from clean, pushed source and within push authorization. On dirty/unpushed or infrastructure failure, read available diagnostics and report the blocker; do not auto-commit/push, retry, or fall back to a heavy local run. If the child uses remote verification, it must pass its worktree as `cwd`.
- Instructions to capture its own starting HEAD/status/untracked inventory; preserve pre-existing work; read and follow [matt-tdd](../matt-tdd/SKILL.md) at the agreed seams; stop after its ticket and report out-of-scope discoveries instead of expanding work. Do not recursively delegate the whole build.
- The [issue lifecycle](../matt-triage/SKILL.md#roles) and [priority policy](../matt-triage/SKILL.md#priority-extension). Before starting, re-fetch the ticket, replace readiness with the mapped `in-progress` state, preserve category/priority and project labels, and verify the transition. Missing priority, conflicting states, or a closed ticket require direction; failed tracker updates are blockers. Never mark the whole backlog in progress.
- Instructions to read and follow [matt-code-review](../matt-code-review/SKILL.md) before its ticket commit, using explicit working-tree scope from its captured baseline and only its newly created untracked files. Both axes receive frozen inputs. Resolve material findings by fixes or an explicit user retention decision; rerun affected checks and both axes after changes. This preserves the local pre-commit safeguard; the final integration review covers a different scope.
- A completion report containing commit SHA(s), changed-file inventory, observed tracker state, acceptance-criteria coverage, commands/results, and remaining uncertainty. Commit only owned ticket changes. Leave the ticket open/in-progress until the parent handles authorized completion; do not publish a PR, close tickets, or clean up worktrees independently.

Coordinate shared browser/server resources: assign one owner or explicitly separate sessions before simultaneous UI checks. Avoid duplicate suites by recording what each child owns and what the parent will run.

## 4. Integrate serially and advance the frontier

Use one bounded **merger subagent** at a time, or integrate directly when the operation is atomic. Integration-branch writes are serialized; implementers never mutate that checkout.

Immediately before landing each result, verify the branch/path/commit, clean status, ticket scope, evidence, and that it includes the current integration tip. If the tip advanced, have the implementer merge that tip into its own branch and rerun affected checks before returning; repeat if another result landed meanwhile. Resolve conflicts by the spec and both sides' intent, not by discarding one side. Report unresolved conflicts and preserve the work; do not reset or automatically abort.

Once current, fast-forward the integration branch to the ticket result. Verify the integrated SHA and record the completed graph node. Only then unblock dependents and dispatch more work. No readiness transition or partial implementation alone counts as a completed dependency.

If the tracker closes work through PRs and publishing is authorized, open a draft PR only after the first integration commit ahead of the base. Read [matt-pr](../matt-pr/SKILL.md) for its body and retain project evidence requirements. Include closing references only for work actually delivered; update them if the run becomes partial. Otherwise keep the local integration branch and report any permission needed for publishing.

## 5. Verify and review the whole spec

After all scheduled required nodes are integrated, run the agreed integrated checks once. Record source SHA, execution location, tested scope, pass/fail/skip counts, and remaining uncertainty. Focused ticket passes do not imply an integrated pass. Follow project UI journey and keyboard requirements as well as automation.

Read and follow [matt-code-review](../matt-code-review/SKILL.md) against the captured integration baseline with the whole spec and applicable standards. For a clean branch use committed scope; for pending fixes use explicit working-tree scope with its baseline, starting status, and exact newly created untracked-file list. Freeze the same scope/spec/standards inputs for both axes.

Delegate each necessary fix as a narrower assignment in an owned checkout. Dispose of every material finding by fixing it or obtaining an explicit retention decision. After code or review-input changes, rerun affected verification and both review axes on the new frozen scope. Do not claim completion, mark a PR ready, or resolve tickets while material findings or required checks remain unresolved.

## 6. Handoff and authorized cleanup

If authorized, mark the draft PR ready or resolve the completed tickets using the configured tracker workflow. A PR-based tracker may leave issues open until merge. Re-fetch tickets and verify every transition; preserve category/priority/project labels, retain `in-progress` for open work, clean it up for closed work, or restore readiness only when work is explicitly released/abandoned. Report blocked tickets and partial results honestly; do not close the spec until its requirements are delivered.

List owned implementer worktrees with path, branch, status, and integration ancestry. Read [git-worktree-remove](../git-worktree-skills/remove/SKILL.md) and its policy before removal; get explicit confirmation of resolved paths after the safety report. Preserve dirty, locked, active, or unmerged work, keep branches, and leave the integration checkout available for handoff. Installation or invocation of this skill is not blanket cleanup authorization.

Report the integration branch/path/SHA, ticket outcomes, review and verification evidence, PR state if applicable, and retained worktrees. Offer `/skill:matt-retro` in this session before clearing context, or with a pointer to this session log; do not run it as an implicit second workflow.
