---
name: tmux-operations
description: Inspect tmux sessions and windows, create detached sessions and windows, and send literal command input to panes. Use for minimal, non-destructive tmux orchestration within larger workflows.
compatibility: Requires tmux and Bash.
---

# Tmux Operations

Use the small set of operations below as composable primitives. Perform no destructive or disruptive tmux lifecycle operations.

## Safety and targeting

- Allowed operations: list sessions, list windows, create a detached session, create a window, send literal text, and send Enter.
- Never attach, kill, rename, move, swap, join, break, unlink, respawn, or replace tmux resources. Never send control keys.
- Never use `new-session -A`; it may attach to an existing session.
- Prefer stable tmux IDs (`$1`, `@2`, `%3`) after discovery or creation. Quote every shell variable.
- Resolve user-provided names exactly. If a name is ambiguous, stop and ask rather than guessing.
- A window name is a label and need not be unique. Use the returned window and pane IDs.
- `send-keys -l` makes text literal to tmux, but pressing Enter executes it in the pane's program. Send only commands authorized by the current task and subject them to the surrounding workflow's normal safety rules.
- Type into a pane only when the workflow knows that pane is ready for input. Prefer the pane ID returned by a create operation.
- Treat typing text and pressing Enter as separate operations. Do not press Enter unless execution was requested.

The formats below are tab-separated because Bash `$'...'` quoting inserts real tab characters. Names use tmux's `q` modifier so unusual characters are escaped.

## List sessions

```bash
tmux list-sessions -F $'#{session_id}\t#{q:session_name}\t#{session_windows}\t#{session_attached}'
```

Fields: session ID, quoted session name, window count, attached client count.

When no tmux server is running, `tmux list-sessions` exits nonzero and normally reports `no server running`; treat that specific condition as an empty list. Report other errors normally.

## List all windows

```bash
tmux list-windows -a -F $'#{session_id}\t#{q:session_name}\t#{window_id}\t#{window_index}\t#{q:window_name}\t#{window_active}\t#{window_panes}\t#{pane_id}'
```

Fields: session ID, quoted session name, window ID, window index, quoted window name, active flag, pane count, active pane ID.

If no tmux server is running, treat that specific condition as an empty list.

## Create a detached session

First reject an exact existing name:

```bash
if tmux has-session -t "=$session_name" 2>/dev/null; then
  printf 'session already exists: %s\n' "$session_name" >&2
  exit 1
fi
```

Then create the session and return its identifiers:

```bash
tmux new-session -d -s "$session_name" -P \
  -F $'#{session_id}\t#{q:session_name}\t#{window_id}\t#{pane_id}'
```

Fields: session ID, quoted session name, initial window ID, initial pane ID.

Do not silently reuse an existing session if creation fails.

## Create a window

Resolve the requested session to one exact session ID before creation. Prefer an ID obtained from `list-sessions`; do not guess from a partial name.

```bash
tmux new-window -t "${session_id}:" -n "$window_name" -P \
  -F $'#{window_id}\t#{window_index}\t#{q:window_name}\t#{pane_id}'
```

Fields: window ID, window index, quoted window name, initial pane ID.

Use the returned pane ID for subsequent input.

## Send literal text without executing it

```bash
tmux send-keys -t "$pane_id" -l -- "$text"
```

This types exactly the supplied text and does not press Enter.

## Send Enter

```bash
tmux send-keys -t "$pane_id" Enter
```

Use this only when execution was explicitly requested and the workflow knows what text is currently waiting in that pane.
