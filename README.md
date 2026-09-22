# pi config

https://pi.dev

## where i belong

`~/.pi`

## fresh setup

### GitHub CLI prerequisite

Install the [GitHub CLI (`gh`)](https://cli.github.com/) before continuing.

Clone this repo before installing Pi so the destination does not already exist:

```bash
git clone git@github.com:gjtiquia/.pi.git ~/.pi
curl -fsSL https://pi.dev/install.sh | sh
```

The packages listed in `agent/settings.json` (currently `pi-web-access` and
`pi-agent-browser-native`) are managed by Pi and should install automatically.
They do not need separate install commands.

### agent-browser prerequisite

The `pi-agent-browser-native` extension requires Vercel's
[`agent-browser`](https://github.com/vercel-labs/agent-browser) CLI. Install it
globally and download its browser once:

```bash
npm install -g agent-browser
agent-browser install
```

On Linux, use `agent-browser install --with-deps` instead if the required
system browser libraries are not already installed.

### notify extension dependency

The local notify extension has its own dependency, so install it explicitly:

```bash
npm ci --prefix ~/.pi/agent/extensions/notify
```

### log in

Credentials are intentionally not committed. Start Pi and authenticate the
providers needed on this machine:

```bash
pi
```

Then run:

```text
/login
```

Select the provider and follow its login flow. Repeat for any additional
providers. Pi stores the resulting credentials in the ignored
`~/.pi/agent/auth.json` file.

### configure Mattermost remote mode

The remote-mode environment file is also intentionally not committed. Create
it from the example:

```bash
cp ~/.pi/agent/extensions/remote-mode/.env.example \
  ~/.pi/agent/extensions/remote-mode/.env
```

Fill in all three values:

```dotenv
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_BOT_TOKEN=...
MATTERMOST_CHANNEL_ID=...
```

The bot account must be able to read and post in that channel. The `.env` file
contains secrets and is ignored by git.

Finally, restart Pi (or run `/reload` from an existing session). Use
`/remote status` to inspect Mattermost remote mode and `/remote on` to enable
it.

### quick check

```bash
pi --version
pi list
npm ls --prefix ~/.pi/agent/extensions/notify --depth=0
```

## fyi

- ignored `/agent/sessions/` cuz it grows a lot and i dun see a need to back these up (yet)
- ignored `/agent/models-store.json` cuz it regenerates and i dun see a need to back these up (yet)
- ignored `/agent/auth.json` for obvious reasons


