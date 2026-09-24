import { SettingsManager, createLocalBashOperations } from "@earendil-works/pi-coding-agent";

export const SHELL_USAGE = ["!$ <command> / !shell <command> — run a shell command in Pi's working directory (unrestricted)"];
const MAX_OUTPUT_BYTES = 64_000;
const TIMEOUT_SECONDS = 120;
const SHELL_COMMAND = /^\s*!(?:\$|shell)(?=\s|$)/;

export async function handleShellCommand(input: string, cwd: string, projectTrusted = false): Promise<string> {
	const match = SHELL_COMMAND.exec(input);
	if (!match) throw new Error("Not a remote shell command");
	const command = input.slice(match[0].length).trim();
	if (!command || command === "help") return `Usage:\n${SHELL_USAGE.join("\n")}`;

	const output: Buffer[] = [];
	let bytes = 0;
	let truncated = false;
	const renderedOutput = () => Buffer.concat(output).toString("utf8").trimEnd();
	try {
		// Use Pi's own shell resolver so shellPath (including zsh), project settings,
		// and the same setup prefix as local ! commands take effect.
		const settings = SettingsManager.create(cwd, undefined, { projectTrusted });
		const prefix = settings.getShellCommandPrefix();
		const operations = createLocalBashOperations({ shellPath: settings.getShellPath() });
		const { exitCode } = await operations.exec(prefix ? `${prefix}\n${command}` : command, cwd, {
			timeout: TIMEOUT_SECONDS,
			onData: (chunk) => {
				const remaining = MAX_OUTPUT_BYTES - bytes;
				if (chunk.length > remaining) truncated = true;
				if (remaining > 0) {
					output.push(chunk.subarray(0, remaining));
					bytes += Math.min(chunk.length, remaining);
				}
			},
		});
		return [`${command} (exit ${exitCode})`, renderedOutput(), truncated ? "[output truncated]" : ""].filter(Boolean).join("\n");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === `timeout:${TIMEOUT_SECONDS}` ? `timed out after ${TIMEOUT_SECONDS}s` : `failed: ${message}`;
		return [`${command} (${status})`, renderedOutput(), truncated ? "[output truncated]" : ""].filter(Boolean).join("\n");
	}
}
