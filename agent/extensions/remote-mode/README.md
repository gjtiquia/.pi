# Mattermost remote mode

A global Pi extension that relays one Mattermost thread to the current Pi session.

## Configuration

Copy `.env.example` to `.env` in this directory and fill in all three values. The extension loads that file with Node's `process.loadEnvFile`; a real `.env` is intentionally not included.

The bot account must be able to read and post in the configured channel. Any non-bot user who can reply in the session's thread can send messages into Pi.

## Usage

- `/remote` toggles remote mode.
- `/remote on` enables it.
- `/remote off` disconnects and stops inbound and outbound relaying.
- `/remote status` reports its state.
- `/remote ping` posts `ping` to the session's Mattermost thread, even when remote mode is off.

Enabling or pinging creates the session's root post if needed. The root is a compact session card:

```text
💬 Project: example-project
Title: (pending)
Session ID: 01a0…
```

After the next user message, remote mode generates a short title in the background and uses it as both the card title and Pi session name. Title generation tries hardcoded low-cost models for the active provider in order; it never switches providers or falls back to the active model. Supported candidates are `openai-codex/gpt-5.3-codex-spark`, `openai-codex/gpt-6-luna`, `opencode-go/deepseek-v4.1-flash`, and `opencode-go/glm-5.3-flash`.

Users can ask Pi naturally to rename the remote session, mark it done (`✅`), or put it back in progress (`💬`). A manual title wins over pending background generation. The built-in `/name` command also updates the Mattermost title. Done is visual metadata only and does not disable remote mode.

Mattermost replies beginning with a recognized `!` command are handled directly, without a main-model turn. Other replies (including unknown `!` commands) remain ordinary prompts:

```text
!help
!token status                 (alias: !tokens status)
!remote set status done|active
!remote set title <title>
!remote update               (regenerate title with a cheap model and refresh the card)
!discuss [on|off|status]      (bare command toggles)
!model [status|help|list]     (list groups the full catalog by provider)
!model set model <model>      (current provider)
!model set model <provider> <model>
!model set effort off|minimal|low|medium|high|xhigh|max
!reload                      (posts progress and success in the thread)
```

`!remote update` can replace even a manually chosen title; if generation fails, it refreshes the card with the existing title and status. Remote reload preserves discuss mode, as does terminal reload.

The enabled state, root post ID, title, and status are stored for that Pi session, so reloads and tree navigation keep using the same thread while forks get their own.
Mattermost replies are sent to Pi immediately when idle or as follow-ups when busy. While remote mode is enabled, work started from either the terminal or Mattermost creates one activity post. Each bracketed update is appended on a new line by editing that same post, for example `[thinking…]`, `[reading src/index.ts]`, and `[responding…]`. It finishes with `[completed]`, followed by the final assistant text as a separate thread reply.
