import { spawn } from "node:child_process";

export const GIT_USAGE = ["!git <args> — run Git in Pi's working directory (unrestricted)"];
const MAX_OUTPUT_BYTES = 64_000;
const TIMEOUT_MS = 120_000;

// Parse shell-style quoting without invoking a shell. Metacharacters and expansions
// remain literal arguments; this is an alias for the Git executable, not a shell.
export function parseGitArgs(input: string): string[] {
	const args: string[] = [];
	let arg = "";
	let started = false;
	let quote: "'" | '"' | undefined;
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (char === "\\" && quote !== "'") {
			if (i + 1 >= input.length) throw new Error("Trailing backslash in Git arguments");
			arg += input[++i];
			started = true;
		} else if (char === quote) {
			quote = undefined;
		} else if (!quote && (char === "'" || char === '"')) {
			quote = char;
			started = true;
		} else if (!quote && /\s/.test(char)) {
			if (started) args.push(arg);
			arg = "";
			started = false;
		} else {
			arg += char;
			started = true;
		}
	}
	if (quote) throw new Error("Unclosed quote in Git arguments");
	if (started) args.push(arg);
	return args;
}

export async function handleGitCommand(input: string, cwd: string): Promise<string> {
	let args: string[];
	try {
		args = parseGitArgs(input.replace(/^\s*!git(?=\s|$)/, ""));
	} catch (error) {
		return `${(error as Error).message}. Usage: ${GIT_USAGE[0]}`;
	}
	if (!args.length) return `Usage:\n${GIT_USAGE.join("\n")}`;

	return new Promise((resolve) => {
		const child = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
		});
		const output: Buffer[] = [];
		let bytes = 0;
		let truncated = false;
		const collect = (chunk: Buffer) => {
			const remaining = MAX_OUTPUT_BYTES - bytes;
			if (chunk.length > remaining) truncated = true;
			if (remaining > 0) {
				const part = chunk.subarray(0, remaining);
				output.push(part);
				bytes += part.length;
			}
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, TIMEOUT_MS);
		let spawnError: Error | undefined;
		child.on("error", (error) => { spawnError = error; });
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const result = Buffer.concat(output).toString("utf8").trimEnd();
			const status = spawnError ? `failed: ${spawnError.message}`
				: timedOut ? `timed out after ${TIMEOUT_MS / 1000}s`
				: signal ? `signal ${signal}` : `exit ${code}`;
			resolve([`git ${args.join(" ")} (${status})`, result, truncated ? "[output truncated]" : ""].filter(Boolean).join("\n"));
		});
	});
}
