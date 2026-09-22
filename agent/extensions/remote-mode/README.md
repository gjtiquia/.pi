# Mattermost remote mode

A global Pi extension that relays one Mattermost thread to the current Pi session.

## Configuration

Copy `.env.example` to `.env` in this directory and fill in all four values. The extension loads that file with Node's `process.loadEnvFile`; a real `.env` is intentionally not included.

The bot account must be able to read and post in the configured channel. Only websocket replies from `MATTERMOST_ALLOWED_USER_ID` in the session's thread are accepted.

## Usage

- `/remote` toggles remote mode.
- `/remote on` enables it.
- `/remote off` disconnects and stops inbound and outbound relaying.
- `/remote status` reports its state.

Enabling creates the session's root post if needed. The enabled state and root post ID are stored for that Pi session, so reloads and tree navigation keep using the same thread while forks get their own. Final assistant text is posted as thread replies; Mattermost replies are sent to Pi immediately when idle or as follow-ups when busy.
