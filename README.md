# pi config

personal config for [pi](https://pi.dev), stored at `~/.pi`

## setup

prerequisites:

- [GitHub CLI (`gh`)](https://cli.github.com/)
- Node.js and npm (installing through [nvm](https://github.com/nvm-sh/nvm) is recommended)

```bash
# clone before installing pi so ~/.pi does not already exist
git clone git@github.com:gjtiquia/.pi.git ~/.pi

# install pi
curl -fsSL https://pi.dev/install.sh | sh

# install agent-browser and download its browser
npm install -g agent-browser
agent-browser install

# install local extension dependencies
npm ci --prefix ~/.pi/agent/extensions/notify
npm ci --prefix ~/.pi/agent/extensions/mattermost-read

# start pi
pi
```

on Linux, use `agent-browser install --with-deps` if the required system browser libraries are not already installed.

inside pi, run `/login` and authenticate each provider needed on the machine. credentials are stored in the ignored `~/.pi/agent/auth.json` file.

packages listed in `agent/settings.json` are managed by pi and install automatically.

## Mattermost

```bash
# shared credentials for remote mode and the read-only Mattermost tools
cp ~/.pi/agent/mattermost/.env.example ~/.pi/agent/mattermost/.env
```

fill in the environment file:

```dotenv
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_BOT_TOKEN=...
MATTERMOST_CHANNEL_ID=...
```

for remote mode, the bot must be able to read and post in the configured channel. `MATTERMOST_CHANNEL_ID` is needed only for remote mode; the independent `read_mattermost_link` and `read_mattermost_attachment` tools need only the URL, token, and read access to the linked posts. They work when remote mode is off. restart pi or run `/reload`, then use `/remote status` to inspect remote mode, `/remote ping` to test the connection, and `/remote on` to enable it.

## Excalidraw+ reader

```bash
# create the local environment file
cp ~/.pi/agent/extensions/excalidraw-plus/.env.example \
  ~/.pi/agent/extensions/excalidraw-plus/.env
```

create a personal Excalidraw+ API key with read-only scene, scene-content, and screenshot access, then add it to the environment file:

```dotenv
EXCALIDRAW_API_KEY=...
```

restart pi or run `/reload`. The `list_excalidraw_scenes` tool lists or searches accessible scenes, and `read_excalidraw` loads one by ID, URL, or title and returns its rendered image, extracted text, and raw `.excalidraw` file.

## model selection policy

`agent/preferences/model-tiers.ts` owns the provider routes and model/thinking selection guidance shared by subagents and Gateway cron. Subagents require exactly one of `modelTier` (`fast`, `balanced`, `deep`) or `model` (`provider/model-id`), plus an explicit `thinkingLevel` supported by that model. There is no `inherit` tier, implicit thinking level, or silent fallback.

For OpenAI Codex, `fast` routes to GPT-6 Luna, `balanced` to GPT-6.1 Sol, and `deep` to GPT-6 Astra. Select capability for ambiguity/judgment, and thinking independently for reasoning depth; Luna with `thinkingLevel: "max"` is a patient budget worker, not a fourth capability tier.

Resuming a child requires an explicit selection matching its original model and thinking. The saved resolved model is pinned even if tier routes or the parent's provider change. Children with old metadata lacking explicit settings must be replaced with a fresh delegation. Run `/reload` or restart Pi to load extension changes.

## quick check

```bash
pi --version
pi list
npm ls --prefix ~/.pi/agent/extensions/notify --depth=0
npm ls --prefix ~/.pi/agent/extensions/mattermost-read --depth=0
```

## notes

- design skills and extensions as composable, single-purpose operations (Unix philosophy); avoid implicit side effects that perform a second action
- `/agent/sessions/` is ignored because it grows quickly and does not need to be backed up yet
- `/agent/models-store.json` is ignored because it regenerates
- `/agent/auth.json` is ignored because it contains credentials
- extension and shared Mattermost `.env` files are ignored because they contain secrets
