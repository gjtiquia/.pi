import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const CHILD_ENV = "PI_MINIMAL_SUBAGENT_CHILD";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const executable = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function getText(message: Message): string {
	if (message.role !== "assistant") return "";
	return message.content
		.filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function truncateForModel(text: string): string {
	const result = truncateHead(text, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});

	if (!result.truncated) return result.content;
	return `${result.content}\n\n[Output truncated. Full output is preserved in the tool details.]`;
}

function oneLine(text: string, maxLength = 120): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function minimalSubagent(pi: ExtensionAPI): void {
	// Child processes must not receive the delegation tool themselves.
	if (process.env[CHILD_ENV] === "1") return;

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Delegate one task to a generic subagent in an isolated Pi process. The child inherits the active model, thinking level, working directory, and active tools except subagent. Give each call a concise summary for display. Multiple subagent calls in one turn run in parallel; call subagent again after a result when later work depends on it.",
		promptSnippet: "Delegate a bounded task to one generic isolated subagent",
		promptGuidelines: [
			"For every subagent call, write summary as a concise one-line description of the instructions being delegated.",
			"Run independent subagent calls together in one turn for parallel work; run dependent subagent calls in later turns for sequential work.",
		],
		parameters: Type.Object({
			summary: Type.String({ description: "Concise one-line summary shown to the user" }),
			task: Type.String({ description: "The complete task to delegate" }),
		}),

		async execute(_toolCallId, { summary, task }, signal, onUpdate, ctx) {
			const args = ["--mode", "json", "-p", "--no-session"];

			if (ctx.model) args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
			if (ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);

			const childTools = pi.getActiveTools().filter((name) => name !== "subagent");
			if (childTools.length > 0) args.push("--tools", childTools.join(","));

			args.push(task);

			const invocation = getPiInvocation(args);
			const messages: Message[] = [];
			let finalOutput = "";
			let stderr = "";
			let stopReason: string | undefined;

			const exitCode = await new Promise<number>((resolve, reject) => {
				const child = spawn(invocation.command, invocation.args, {
					cwd: ctx.cwd,
					env: { ...process.env, [CHILD_ENV]: "1" },
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let stdoutBuffer = "";
				let aborted = false;

				const processLine = (line: string) => {
					if (!line.trim()) return;

					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					if (event.type !== "message_end" || !event.message) return;

					const message = event.message as Message;
					messages.push(message);
					if (message.role !== "assistant") return;

					const text = getText(message);
					if (text) finalOutput = text;
					stopReason = message.stopReason;

					onUpdate?.({
						content: [{ type: "text", text: finalOutput || "Subagent is working…" }],
						details: { summary: oneLine(summary), task, messages },
					});
				};

				child.stdout.on("data", (chunk) => {
					stdoutBuffer += chunk.toString();
					const lines = stdoutBuffer.split("\n");
					stdoutBuffer = lines.pop() ?? "";
					for (const line of lines) processLine(line);
				});

				child.stderr.on("data", (chunk) => {
					stderr += chunk.toString();
				});

				child.on("error", reject);
				child.on("close", (code) => {
					if (stdoutBuffer.trim()) processLine(stdoutBuffer);
					if (aborted) reject(new Error("Subagent was aborted"));
					else resolve(code ?? 1);
				});

				const abort = () => {
					aborted = true;
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
				};

				if (signal?.aborted) abort();
				else signal?.addEventListener("abort", abort, { once: true });
			});

			if (exitCode !== 0 || stopReason === "error") {
				throw new Error(stderr.trim() || finalOutput || `Subagent exited with code ${exitCode}`);
			}

			const output = finalOutput || "Subagent completed without a text response.";
			return {
				content: [{ type: "text", text: truncateForModel(output) }],
				details: { summary: oneLine(summary), task, output, messages },
			};
		},

		renderCall(args, theme) {
			const summary = oneLine(args.summary || args.task || "Preparing delegated task…");
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", summary),
				0,
				0,
			);
		},
	});
}
