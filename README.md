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

# install the local notify extension dependency
npm ci --prefix ~/.pi/agent/extensions/notify

# start pi
pi
```

on Linux, use `agent-browser install --with-deps` if the required system browser libraries are not already installed.

inside pi, run `/login` and authenticate each provider needed on the machine. credentials are stored in the ignored `~/.pi/agent/auth.json` file.

packages listed in `agent/settings.json` are managed by pi and install automatically.

## Mattermost remote mode

```bash
# create the local environment file
cp ~/.pi/agent/extensions/remote-mode/.env.example \
  ~/.pi/agent/extensions/remote-mode/.env
```

fill in the environment file:

```dotenv
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_BOT_TOKEN=...
MATTERMOST_CHANNEL_ID=...
```

the bot must be able to read and post in the configured channel. restart pi or run `/reload`, then use `/remote status` to inspect remote mode, `/remote ping` to test the connection, and `/remote on` to enable it.

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

## quick check

```bash
pi --version
pi list
npm ls --prefix ~/.pi/agent/extensions/notify --depth=0
```

## notes

- design skills and extensions as composable, single-purpose operations (Unix philosophy); avoid implicit side effects that perform a second action
- `/agent/sessions/` is ignored because it grows quickly and does not need to be backed up yet
- `/agent/models-store.json` is ignored because it regenerates
- `/agent/auth.json` is ignored because it contains credentials
- extension `.env` files are ignored because they contain secrets
