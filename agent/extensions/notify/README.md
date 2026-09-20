# Native Notify Extension

Sends a macOS desktop notification when Pi finishes running and is ready for input.

## Setup

Install the extension dependency after cloning this configuration:

```bash
cd ~/.pi/agent/extensions/notify
npm install
```

Then restart Pi or run:

```text
/reload
```

macOS may prompt for notification permission for `terminal-notifier`. Allow it in **System Settings → Notifications** if notifications do not appear.

## Development

- The extension listens for Pi's `agent_settled` event.
- Commit `package.json` and `package-lock.json`.
- Do not commit `node_modules/`; it is ignored by the repository's `.gitignore`.
