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

`agent/preferences/model-tiers.ts` owns the provider presets and selection guidance shared by subagents and Gateway cron. Choose either `modelTier` (`fast`, `balanced`, `deep`) alone, or `model` (`provider/model-id`) plus an explicit supported `thinkingLevel`. Supplying thinking with a tier is rejected. There is no `inherit` tier or silent fallback.

For OpenAI Codex, `fast` bundles GPT-6 Luna medium, `balanced` bundles GPT-6 Luna max, and `deep` bundles GPT-6.1 Sol medium. Default to balanced for scoped work, fast for mechanical tasks, and deep only when the delegated task itself needs difficult judgment. Explicit model-plus-thinking overrides remain available, including Astra medium. Opencode Go retains its existing model routes, each with medium thinking.

Resuming a child requires its original tier alone or an explicit model-plus-thinking selection matching its saved settings. The saved resolved model and thinking are pinned even if tier presets or the parent's provider change. Children with old metadata lacking explicit settings must be replaced with a fresh delegation. Run `/reload` or restart Pi to load extension changes.

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
