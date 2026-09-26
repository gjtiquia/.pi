import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function startCommand(title?: string): string {
	return `pi ${title ? `--name ${shellQuote(title)} ` : ""}'/remote on' '/remote ping'`;
}

function oneShotCommand(prompt: string): string {
	return `PI_ONE_SHOT_CHILD=1 pi -- ${["/remote on", "/remote ping", prompt].map(shellQuote).join(" ")}`;
}

/** Runs tmux with argv (never through a shell); the default inherits this process's environment. */
export type TmuxRunner = (args: readonly string[]) => Promise<string>;

export interface TmuxWindowOptions {
	run?: TmuxRunner;
	env?: NodeJS.ProcessEnv;
}

export type TmuxLaunchResult =
	| { status: "not-tmux" }
	| { status: "created"; sessionId: string; windowId: string; paneId: string };

export type TmuxCloseResult =
	| { status: "not-tmux" }
	| { status: "closed"; windowId: string; paneId: string };

const runTmux: TmuxRunner = async (args) => {
	const { stdout } = await execFileAsync("tmux", [...args], { encoding: "utf8", timeout: 5_000 });
	return stdout;
};

function paneFromEnv(env: NodeJS.ProcessEnv): string | undefined {
	if (!env.TMUX || !env.TMUX_PANE) return;
	if (!/^%\d+$/.test(env.TMUX_PANE)) throw new Error("Invalid TMUX_PANE; refusing to target a tmux window");
	return env.TMUX_PANE;
}

async function currentWindow(paneId: string, run: TmuxRunner): Promise<{ sessionId: string; windowId: string }> {
	const fields = (await run(["display-message", "-p", "-t", paneId,
		"#{pane_id}\t#{session_id}\t#{window_id}"])).trim().split("\t");
	if (fields.length !== 3 || fields[0] !== paneId || !/^\$\d+$/.test(fields[1]) || !/^@\d+$/.test(fields[2])) {
		throw new Error("Could not resolve the exact current tmux pane and window");
	}
	return { sessionId: fields[1], windowId: fields[2] };
}

/**
 * Create a detached, shell-backed window in the current pane's exact session.
 * The new Pi process is typed into the newly created pane, not used as the
 * window command: exiting Pi therefore leaves the interactive shell alive.
 * A non-tmux caller gets a no-op. Errors after creation leave the window intact.
 */
export async function launchRemoteTmuxWindow(
	cwd: string,
	title?: string,
	options: TmuxWindowOptions = {},
): Promise<TmuxLaunchResult> {
	return launchTmuxWindow(cwd, startCommand(title), options);
}

/** Start a separate interactive Pi session and return as soon as its command is sent. */
export async function launchOneShotTmuxWindow(
	cwd: string,
	prompt: string,
	options: TmuxWindowOptions = {},
): Promise<TmuxLaunchResult> {
	if (!prompt.trim()) throw new Error("One-shot prompt cannot be empty");
	return launchTmuxWindow(cwd, oneShotCommand(prompt), options);
}

async function launchTmuxWindow(
	cwd: string,
	command: string,
	{ run = runTmux, env = process.env }: TmuxWindowOptions = {},
): Promise<TmuxLaunchResult> {
	const currentPaneId = paneFromEnv(env);
	if (!currentPaneId) return { status: "not-tmux" };
	const { sessionId } = await currentWindow(currentPaneId, run);
	const shell = env.SHELL || "/bin/sh";
	const fields = (await run(["new-window", "-d", "-t", `${sessionId}:`, "-c", cwd,
		"-P", "-F", "#{window_id}\t#{pane_id}", "--", shell, "-i"])).trim().split("\t");
	if (fields.length !== 2 || !/^@\d+$/.test(fields[0]) || !/^%\d+$/.test(fields[1])) {
		throw new Error("tmux did not return the new window and pane IDs; refusing to send input");
	}
	const [windowId, paneId] = fields;
	await run(["send-keys", "-t", paneId, "-l", "--", command]);
	await run(["send-keys", "-t", paneId, "Enter"]);
	return { status: "created", sessionId, windowId, paneId };
}

/**
 * Invoke only after the caller has sent its Mattermost acknowledgement and
 * updated the card. This explicitly requested operation kills only the window
 * containing this process's TMUX_PANE, identified by its stable window ID.
 */
export async function closeCurrentTmuxWindow(
	{ run = runTmux, env = process.env }: TmuxWindowOptions = {},
): Promise<TmuxCloseResult> {
	const paneId = paneFromEnv(env);
	if (!paneId) return { status: "not-tmux" };
	const { windowId } = await currentWindow(paneId, run);
	await run(["kill-window", "-t", windowId]);
	return { status: "closed", windowId, paneId };
}
