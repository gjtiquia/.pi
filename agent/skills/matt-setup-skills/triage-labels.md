# Triage Labels

The triage skill uses category, state, and priority roles. This file maps each role to the actual label string used in this repo's issue tracker.

## Category (exactly one per triaged issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `bug` | `bug` | Something is broken |
| `enhancement` | `enhancement` | New feature or improvement |

## State (exactly one per triaged issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `in-progress` | `in-progress` | Implementation is actively underway |
| `wontfix` | `wontfix` | Will not be actioned |

`in-progress` replaces the readiness state while work is active; do not apply both.

## Priority (exactly one per triaged open issue)

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `P0` | `P0` | Emergency; interrupts current work |
| `P1` | `P1` | Foundational or blocking work |
| `P2` | `P2` | Ordinary planned work (default) |
| `P3` | `P3` | Optional backlog |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from these tables. Priority is independent of state.

Edit the right-hand column to match whatever vocabulary you actually use.
