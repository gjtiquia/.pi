# Mattermost reader

A read-only Pi extension for Mattermost post permalinks and attachments. It does not depend on remote mode being enabled or a configured relay channel.

## Setup

Install the local PDF dependency with `npm ci --prefix ~/.pi/agent/extensions/mattermost-read`. Copy `agent/mattermost/.env.example` to `agent/mattermost/.env` and configure `MATTERMOST_URL` and `MATTERMOST_BOT_TOKEN` there; `MATTERMOST_CHANNEL_ID` is only needed by remote mode. The two extensions share this ignored Mattermost-specific credential file. Restart Pi or run `/reload`.

The bot must have read access to the linked post's channel and files. Nothing is posted or saved to disk; bearer tokens are not forwarded on HTTP redirects.

## Tools

- `read_mattermost_link({ link })` reads the linked post and its full thread, with each post's permalink and attachment file IDs. Output is capped at 500 posts / 150,000 characters and explicitly marked if truncated.
- `read_mattermost_attachment({ link, fileId })` reads a file from the **post containing it**. Text is UTF-8 (100,000 character output limit); PDFs are extracted in memory via `pdfjs-dist` (10 pages / 50,000 characters by default); PNG, JPEG, GIF, and WebP are returned as image content. Other files are rejected. Downloads are capped at 20 MiB, images at 10 MiB.

Use the permalink and file ID shown for an attachment in the first tool's result.
