import { terminalReply } from "./terminal-reply.ts";
import { SettingsManager, createLocalBashOperations } from "@earendil-works/pi-coding-agent";

export const SHELL_USAGE = ["!$ <command> / !shell <command> — run a shell command in Pi's working directory (unrestricted)"];
const MAX_OUTPUT_BYTES = 64_000;
const TIMEOUT_SECONDS = 120;

export async function runShell(payload: string, cwd: string, projectTrusted = false): Promise<string> {
	const command = payload.trim();
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
		return terminalReply(command, renderedOutput(), `exit ${exitCode}`, truncated);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = message === `timeout:${TIMEOUT_SECONDS}` ? `timed out after ${TIMEOUT_SECONDS}s` : `failed: ${message}`;
		return terminalReply(command, renderedOutput(), status, truncated);
	}
}
