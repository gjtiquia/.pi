# Native Notify Extension

Sends a macOS desktop notification when Pi finishes running and is ready for input.

The notification title is `Pi - agent_settled`. Its body shows the tmux session and window index when Pi runs inside tmux (for example, `dotfiles: 2`); otherwise, it shows the current project directory name.

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
- Subagent processes do not notify; only the root Pi session sends a notification.
- Commit `package.json` and `package-lock.json`.
- Do not commit `node_modules/`; it is ignored by the repository's `.gitignore`.
