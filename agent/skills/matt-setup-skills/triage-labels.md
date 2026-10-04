# Triage Labels

The triage skill uses category, state, and priority roles. This file maps each role to the actual label string used in this repo's issue tracker.

## Category (exactly one per triaged issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `bug` | `bug` | Something is broken |
| `enhancement` | `enhancement` | New feature or improvement |

## State (exactly one per triaged open issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `in-progress` | `in-progress` | Implementation has started; issue remains open |
| `wontfix` | `wontfix` | Will not be actioned |

Starting implementation replaces readiness with `in-progress`. Keep it until the issue closes, even after implementation finishes or a PR opens. On closure, remove it without restoring readiness; closed issues may then have no state label. If work is abandoned/released while open, restore the appropriate readiness state. Preserve category and priority, and verify label transitions.

## Priority (exactly one per open issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `P0` | `P0` | Emergency; interrupts current work |
| `P1` | `P1` | Foundational or blocking work |
| `P2` | `P2` | Ordinary planned work (default) |
| `P3` | `P3` | Optional backlog |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from these tables. Priority is independent of state. Every open issue needs exactly one priority, including untriaged/existing issues, generated specs/tickets, and Wayfinder maps and decision/research tickets. New issues receive it at creation (P2 by default; use P0/P1/P3 only with concrete reasons). Preserve an existing single priority and ask before resolving conflicts. Existing gaps are surfaced for an authorized triage/backfill pass; closed historical issues are not backfilled.

Edit the right-hand column to match whatever vocabulary you actually use.
