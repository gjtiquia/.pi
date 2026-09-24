# Mattermost remote mode

A global Pi extension that relays one Mattermost thread to the current Pi session.

## Configuration

Copy `.env.example` to `.env` in this directory and fill in all three values. The extension loads that file with Node's `process.loadEnvFile`; a real `.env` is intentionally not included.

The bot account must be able to read and post in the configured channel. Any non-bot user who can reply in the session's thread can send messages into Pi.

## Usage

- `/remote` toggles remote mode.
- `/remote on` enables it.
- `/remote off` disconnects and stops inbound and outbound relaying. An unfinished card switches to ❌; a done card stays ✅.
- `/remote status` reports its state.
- `/remote ping` posts `ping` to the session's Mattermost thread, even when remote mode is off.

Enabling or pinging creates the session's root post if needed. The root is a compact session card:

```text
💬 Project: example-project
Title: (pending)
Session ID: 01a0…
```

After the next user message, remote mode generates a short title in the background and uses it as both the card title and Pi session name. Title generation tries hardcoded low-cost models for the active provider in order; it never switches providers or falls back to the active model. Supported candidates are `openai-codex/gpt-5.3-codex-spark`, `openai-codex/gpt-6-luna`, `opencode-go/deepseek-v4.1-flash`, and `opencode-go/glm-5.3-flash`.

Users can ask Pi naturally to rename the remote session, mark it done (`✅`), or put it back in progress (`💬` when connected, `❌` when disconnected). A manual title wins over pending background generation. The built-in `/name` command also updates the Mattermost title. Done is work status independent of connectivity: ✅ remains when remote mode is off; an unfinished disconnected session shows ❌.

Mattermost replies beginning with a recognized `!` command are handled directly, without a main-model turn. Other replies (including unknown `!` commands) remain ordinary prompts. Bare commands and `help` show usage plus current status; actions require explicit arguments:

```text
!help                         (all commands, with status)
!git <args>                   (run Git in Pi's working directory; unrestricted)
!$ <command> / !shell <command> (run a shell command in Pi's working directory; unrestricted)
!token / !tokens              (help + footer-style stats)
!token status                 (alias: !tokens status)
!skill / !skill help          (usage; does not invoke a skill)
!skill list                   (loaded skill names, one per line)
!skill search <keywords>      (case-insensitive name/description search; all words match)
!skill filter <keywords>      (alias: !skill search)
!skill <skill-name> [prompt]  (invoke /skill:<skill-name> [prompt] in Pi)
!remote                       (help + status)
!remote set status done|active
!remote set title <title>
!remote update               (regenerate title with a cheap model and refresh the card)
!discuss                      (help + status, does not toggle)
!discuss on|off|status
!model                        (help + status)
!model list                   (full catalog grouped by provider)
!model set model <model>      (current provider)
!model set model <provider> <model>
!model set effort off|minimal|low|medium|high|xhigh|max
!reload this                  (posts progress and result in the thread)
!new session                 (parallel Pi in a new tmux window, old thread stays online)
!close this                  (disconnect and close this tmux window)
```

`!git` invokes the Git executable directly with shell-style quoted arguments, without a shell or model turn. Git aliases and hooks still run normally. Bare `!git` shows usage. Output (up to 64 KB), errors, and the exit status are posted to the thread; commands time out after two minutes. Interactive prompts and pagers are disabled.

`!$` and `!shell` are aliases that execute the rest of the message as shell code, without a model turn. They use Pi's configured `shellPath` (Bash by default, or Zsh if configured), `shellCommandPrefix`, and working directory. Bare aliases show usage. Output is capped at 64 KB and execution times out after two minutes. Anyone who can reply in the session thread can execute arbitrary commands with Pi's OS permissions; do not enable remote mode in an untrusted thread.

Skill names must match a loaded skill exactly. An unknown name returns a hint rather than starting a model turn; skill invocations queue as follow-ups while Pi is busy. `help`, `list`, `search`, and `filter` are reserved subcommands.

Bare `!reload`, `!new`, and `!close` show help and status instead of acting. `!new session` starts a fresh Pi in a shell-backed tmux window (with `/remote on` and `/remote ping` as startup commands), leaving the current session and window untouched. Pi exiting does not close the new window. Outside tmux, `!new session` does nothing. `!close this` acknowledges the request, disconnects remote mode, and closes its current tmux window; outside tmux it disconnects but leaves Pi open.

`!remote update` can replace even a manually chosen title; if generation fails, it refreshes the card with the existing title and status. Remote reload preserves discuss mode, as does terminal reload.

The enabled state, root post ID, title, and status are stored for that Pi session, so reloads and tree navigation keep using the same thread while forks get their own.
Mattermost replies are sent to Pi immediately when idle or as follow-ups when busy. While remote mode is enabled, work started from either the terminal or Mattermost creates one activity post. Each bracketed update is appended on a new line by editing that same post, for example `[thinking…]`, `[reading src/index.ts]`, and `[responding…]`. It finishes with `[completed]`, followed by the final assistant text as a separate thread reply.
