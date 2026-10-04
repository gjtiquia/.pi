---
name: remote-mode-rescue
description: Diagnose and restore an unresponsive Pi Mattermost remote thread. Use when GJ says remote mode stopped, asks to rescue or resume a remote session, or asks to ping a stalled thread. Resolve the exact saved session, avoid duplicate processes, restore connectivity, and verify the original thread.
compatibility: Pi with the remote-mode extension, local saved session history, and tmux. Linux user journals optionally provide OOM diagnostics.
---

# Remote Mode Rescue

Restore access to an existing Pi session, not a fresh replacement conversation. This is a cross-project workflow; the current working directory is not necessarily the affected project's directory.

## Safety rules

- Treat diagnosis as read-only until the user authorizes restoration. A request to resume/rescue the session or ping its stalled thread authorizes the necessary connectivity restoration, not arbitrary project work.
- Resolve the exact saved session and check for a live owner before launching anything. Never knowingly run two Pi processes against the same session file.
- Do not kill, interrupt, replace, or close a live Pi process or tmux resource. Do not send control keys. Do not type into a pane whose identity or input readiness is uncertain.
- Do not automatically resume unfinished implementation, rerun tools, restart subagents, commit, push, or change memory/configuration settings. Restoring a conversation does not restore in-flight tool execution.
- Keep session contents local. Do not print credentials, full process environments, or unnecessary private conversation contents.

## 1. Resolve the conversation

1. Read the supplied Mattermost permalink using `read_mattermost_link`.
2. Identify the root thread and its session card: project, title, and exact Session ID. A reply permalink may point inside the thread; use the root's identity.
3. Find the corresponding `.jsonl` under `~/.pi/agent/sessions/`. Prefer an exact session ID match and use the full file path when resuming.
4. Verify the session header's ID and working directory. Inspect remote-mode custom state for the original `rootPostId` and `sessionId`; inspect the installed extension to identify its current state format rather than assuming a fixed schema. Compare these with the root post ID from the supplied permalink and the session card. Stop on a mismatch. If either original-root linkage cannot be verified, carry that as unverified through the final report.
5. If session identity, working directory, or destination tmux session is ambiguous, ask. Do not choose the newest session or infer identity solely from a window title.

Read bounded excerpts, not entire large transcripts. Session filenames and process titles are lookup hints, not proof of a live owner.

## 2. Determine whether it is alive

Load the global `tmux-operations` skill for targeting and input safety.

Discover every pane, not just the active pane of each window:

```bash
tmux list-panes -a -F '#{session_id}\t#{session_name}\t#{window_id}\t#{window_name}\t#{pane_id}\t#{pane_pid}\t#{pane_current_command}'
```

For candidate panes, inspect recent output non-destructively:

```bash
tmux capture-pane -p -t '%PANE_ID' -S -40
```

Match the displayed Session ID, not merely the project or title. Inspect the pane's process descendants and other Pi processes as needed; a session may run outside tmux. If an unaccounted-for Pi process could own the session, investigate locally before launching a duplicate. If ownership remains uncertain, stop and explain the uncertainty.

- **Alive and connected:** the agent may be waiting for a tool, busy, or stalled. A missing reply is not proof of disconnection. Report what is observed; do not interrupt it.
- **Alive but disconnected:** when the matching pane is ready to accept slash commands, use `/remote on` and verify connectivity. Before `/remote ping`, capture a baseline of the original root thread; afterward verify the new ping there as required in step 4.
- **No live owner found:** restore from its saved session after confirming the correct tmux destination.

Use `/remote on`, not bare `/remote`: bare `/remote` toggles and could disable a restored connection. If the installed extension differs, verify its command behavior first.

## 3. Restore a dead session

Resolve the user's tmux session name exactly to its stable session ID. If it does not exist, ask before creating a replacement session unless the user already authorized that.

Create a new detached, shell-backed window using the explicitly requested Bash-backed variant in the `tmux-operations` workflow; leave that workflow's generic default unchanged. Record the returned window and pane IDs. Leave existing windows untouched.

In the new shell pane, send a safely shell-quoted command using the verified working directory and saved session path:

```text
cd '<verified working directory>' && pi --session '<exact saved .jsonl path>'
```

Send literal input and Enter separately. Verify startup through a fresh capture before sending more commands. Do not assume a fixed sleep means startup succeeded.

Confirm that the displayed Session ID matches the requested session. Send `/remote on` first and verify connectivity. Before pinging, re-read the original root thread with `read_mattermost_link` and note its latest post as a baseline. Then send `/remote ping` separately.

Resume errors or partial startup require inspection before retrying; do not create a series of speculative windows.

## 4. Verify and report

Verify these independently:

- `remote: connected` for the correct Session ID.
- After `/remote ping`, a new ping is visible in a fresh `read_mattermost_link` result for the original root thread, compared with the pre-ping baseline. Verify that thread's root post ID matches the original root ID recorded during resolution. `Ping sent to Mattermost` in the pane alone does not prove delivery to the original thread.

If root linkage cannot be verified or the new ping is not observed in that exact thread, report the ping as **unverified**. If it appears in a different/new thread, report the mismatch; do not claim the original thread was restored.

Report the destination tmux session/window, connectivity, root linkage, and ping as verified or unverified. State that unfinished work needs a new instruction if relevant. Do not claim the agent is continuing work merely because its conversation was restored.

## 5. Optional read-only diagnosis

Repeated disappearance merits checking resource pressure, separately from restoring access:

- Read `journalctl --user` around the incident for tmux scope exits and `oom-kill` results. Correlate a scope's start time/pane PID with the affected session before attributing it.
- Read `free -h` for current memory and swap. Current pressure does not establish past pressure.
- Read available cgroup `memory.events` counters. These are cumulative and do not identify an incident's time or victim.
- Kernel journal/dmesg access may be restricted. Do not bypass permissions or change access settings. Report the limitation.
- Inspect bounded saved-session/test-log excerpts for the last activity, without rerunning it.

Distinguish evidence from inference. An OOM-killed scope can explain a lost window, but without kernel details the exact killed process may remain unknown. A missing window alone does not prove OOM or a remote-mode bug.

No logging, swap, tmux, extension, or project changes are part of rescue unless separately approved.
