# Mattermost remote mode

A global Pi extension that relays one Mattermost thread to the current Pi session.

## Shared commands and downstream copy

`shared/` is the canonical, copyable command implementation. Copy the **entire directory** (including `package.json` and tests) into the downstream `pi-personal` host; do not copy remote `index.ts` or implement a second parser. Internal imports never reach outside `shared/`.

- `core/`: generic routing, usage, aliases, and catalog rendering.
- `standalone/`: Git and shell execution, using the adapter's cwd and project trust. These need no live session. Shell intentionally depends on `@earendil-works/pi-coding-agent` for Pi shell settings/resolution; Git uses Node only.
- `hosted/`: skill, model, agent delivery/abort, and token logic, operating on a structural session adapter (no ExtensionAPI dependency). Compaction also requires the live session adapter; it is not a standalone shell command.
- Remote `index.ts`: builds the adapter, posts replies, handles unknown-command prompt fallback, and owns discuss/remote/reload/new/close, tmux, and thread cards.

### Public interface (`shared/index.ts`)

```ts
createCommandDispatcher(host: CommandHost, local?: CommandDefinition[]):
  (input: string) => Promise<CommandResult>
registerSharedCommands(host: CommandHost, local?: CommandDefinition[]): CommandDefinition[]
```

Use `createCommandDispatcher` for **all** inbound commands; it preserves raw shell/skill/queue/steer payloads before generic action routing. `classifySharedCommand(input)` derives standalone versus session-dependent commands from that same catalog; mark new hosted definitions `sessionRequired: true` so downstream does not need a separate name list. `registerSharedCommands` composes catalog definitions only, for inspection/help integrations; it is not a replacement dispatcher. Local names/aliases must not collide with shared names. Shared catalog entries precede local entries. A handled result may have no response; only `{ handled: false }` should fall through to the host's ordinary prompt path. Transport posting/chunking and thrown-error reporting belong to the caller.

Type exports: `CommandHost`, `CommandResult`, `CommandDefinition`, `ModelHost`, `ModelRef`, `Effort`, `TokenEntry`, `TokenUsage`, `TokenSnapshot`. The exact structural contract is in `shared/host.ts`:

- `cwd: string`, `projectTrusted: boolean` are host-authorized execution context, not user input.
- `isIdle()`, `hasPendingMessages()`, `abort()` (abort AND clear pending messages).
- `compact(): Promise<void>` compacts the active Pi session, resolving only when finished and rejecting on failure. Bind it to `ctx.compact({ onComplete, onError })`; it requires a live session and must not be implemented by launching a separate Pi process. Shared `!compact this` / `!compress this` refuses to start while work or queued messages remain, since Pi's manual compaction otherwise aborts active work.
- `sendUserMessage(prompt, options?)`, with optional `deliverAs: "steer" | "followUp"` and `expandPromptTemplates: boolean` fields. Shared logic decides idle/busy delivery and skill expansion.
- `getSkills()` returns `{ name, description?, source }[]`; only `source === "skill"` is included.
- `model.current()` returns `{ provider, id } | undefined`; `list()` returns that catalog; `set(ref): Promise<boolean>` returns false for missing auth; `getEffort(): string`; `setEffort(Effort): void`.
- `tokens()` returns `{ entries, percent?, contextWindow }`. Entries are structural Pi session entries (`type`, optional `usage`, optional `message: { role, usage? }`). Usage is `{ input, output, cacheRead, cacheWrite, cost: { total } }`. The host supplies the effective context-window fallback; shared code aggregates and formats statistics.

Bind the adapter to a valid session context; rebuild it after session replacement. Methods should read current session state rather than cache it. No Mattermost, environment credentials, installation paths, or gateway dependencies occur in the shared directory.

### Tests

Install the remote-mode test dependencies, then run the complete suite from the repository root:

```sh
npm ci --prefix agent/extensions/remote-mode
npm test --prefix agent/extensions/remote-mode
```

The test package pins Pi's runtime dependency; update it when upgrading Pi. Dispatcher tests exercise composition/fallback, session delivery, skills, model validation, token aggregation, cwd, and trusted/untrusted shell settings. Lower-level parser/execution tests live beside their modules. `shared/package.json` declares ESM so these tests also run after a standalone directory copy.

## Configuration

Copy `agent/mattermost/.env.example` to `agent/mattermost/.env` and fill in all three values. Remote mode and the separate Mattermost reader extension load the same ignored credential file.

The bot account must be able to read and post in the configured channel. Any non-bot user who can reply in the session's thread can send messages into Pi.

The independent read-only tools live in `agent/extensions/mattermost-read/`; see its README for supported attachments and limits. They need only the URL and bot token, and remain available when `/remote off`.

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

Mattermost replies beginning with a recognized `!` command are handled directly, without a main-model turn. Other replies (including unknown `!` commands) remain ordinary prompts. Most bare commands show usage plus current status; `!stop`, `!abort`, `!help`, `!list`, and `!ls` act immediately:

```text
!help / !list / !ls           (all commands, with status)
!stop / !abort                (abort current work and clear queued messages)
!compact this / !compress this (compact the active Pi session; idle only)
!queue <prompt>               (send after current work finishes)
!steer <prompt>               (steer current work as soon as possible)
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
!remote done                 (alias for !remote set status done)
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
!new session [title]         (parallel Pi in a new tmux window, optionally named; old thread stays online)
!one-shot <prompt>           (independent remote Pi in a new tmux window; preserve prompt whitespace)
!close this                  (disconnect and close this tmux window)
```

`!git` invokes the Git executable directly with shell-style quoted arguments, without a shell or model turn. Git aliases and hooks still run normally. Bare `!git` shows usage. Output (up to 64 KB), errors, and the exit status are posted to the thread; commands time out after two minutes. Interactive prompts and pagers are disabled.

`!$` and `!shell` are aliases that execute the rest of the message as shell code, without a model turn. They use Pi's configured `shellPath` (Bash by default, or Zsh if configured), `shellCommandPrefix`, and working directory. Bare aliases show usage. Output is capped at 64 KB and execution times out after two minutes. Anyone who can reply in the session thread can execute arbitrary commands with Pi's OS permissions; do not enable remote mode in an untrusted thread.

Skill names must match a loaded skill exactly. An unknown name returns a hint rather than starting a model turn; skill invocations queue as follow-ups while Pi is busy. `help`, `list`, `search`, and `filter` are reserved subcommands.

Bare `!compact` and `!compress` show usage instead of acting. They are session-dependent shared commands (`sessionRequired: true`), not standalone commands; completion or failure is posted after Pi finishes compaction. Bare `!reload`, `!new`, and `!close` show help and status instead of acting. `!new session` starts a fresh Pi in a shell-backed tmux window (with `/remote on` and `/remote ping` as startup commands), leaving the current session and window untouched. `!new session <title>` sets the new Pi session name before remote mode starts, so its first Mattermost card uses that title and automatic title generation is skipped. Pi exiting does not close the new window. Outside tmux, `!new session` does nothing. `!one-shot <prompt>` is available only as a Mattermost remote command (not a model tool or terminal command). It starts a separate interactive Pi in the same tmux session, always enables remote mode, pings its new thread, then runs the prompt. It returns a launch acknowledgement in the original thread without waiting for the result; outside tmux it starts nothing. One-shot sessions cannot launch another one-shot. `!close this` acknowledges the request, disconnects remote mode, and closes its current tmux window; outside tmux it disconnects but leaves Pi open.

`!remote update` can replace even a manually chosen title; if generation fails, it refreshes the card with the existing title and status. Remote reload preserves discuss mode, as does terminal reload.

The enabled state, root post ID, title, and status are stored for that Pi session, so reloads and tree navigation keep using the same thread while forks get their own.
Mattermost replies are sent to Pi immediately when idle or as follow-ups when busy. `!queue` explicitly requests a follow-up, and `!steer` interrupts at the next steering boundary; either sends normally when idle. Both require a non-empty prompt. `!stop` and `!abort` match Escape in Pi: they abort current work and clear pending steering and follow-up messages (restoring them to the terminal editor as drafts). While remote mode is enabled, work started from either the terminal or Mattermost creates one activity post. Each bracketed update is appended on a new line by editing that same post, for example `[thinking…]`, `[reading src/index.ts]`, and `[responding…]`. It finishes with `[completed]`, followed by the final assistant text as a separate thread reply.
