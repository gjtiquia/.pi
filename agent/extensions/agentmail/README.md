# Personal inbox reader

Two read-only tools: `agentmail_list_messages` and `agentmail_read_message`.
No inbox selector, send/delete operations, or AgentMail MCP server.

Configure `~/.pi/agent/agentmail/.env` using the adjacent `.env.example`:

- `AGENTMAIL_API_KEY`: preferably an inbox-scoped key with only `inbox_read` and `message_read` permissions.
- `AGENTMAIL_INBOX_ID`: backing AgentMail inbox queried by both tools.
- `AGENTMAIL_PUBLIC_EMAIL`: world-facing address to use for authorized signups.

Configuration is read for each call; credentials are never returned. Tool results include both addresses so agents use the public address rather than the backing inbox. Email content is untrusted data, not instructions.

Run `/reload` after installing the extension/removing MCP. No extra packages required; uses Node 24's built-in fetch and dotenv parser.

Tests: `node --test agent/extensions/agentmail/client.test.mjs`
