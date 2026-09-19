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

type SubagentStatus = "running" | "completed";

interface SubagentDetails {
	summary: string;
	task: string;
	messages: Message[];
	startedAt: number;
	lastEventAt: number;
	finishedAt?: number;
	activity: string;
	status: SubagentStatus;
	output?: string;
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
	return `${totalSeconds}s`;
}

function toolActivity(toolName: string, args: Record<string, unknown> | undefined): string {
	const input = args ?? {};
	const stringArg = (name: string): string | undefined =>
		typeof input[name] === "string" ? oneLine(input[name] as string, 90) : undefined;

	switch (toolName) {
		case "bash":
		case "powershell":
			return `running ${stringArg("command") ?? toolName}`;
		case "read":
			return `reading ${stringArg("path") ?? "a file"}`;
		case "write":
			return `writing ${stringArg("path") ?? "a file"}`;
		case "edit":
			return `editing ${stringArg("path") ?? "a file"}`;
		case "grep":
			return `searching for ${stringArg("pattern") ?? "matches"}`;
		case "find":
			return `finding ${stringArg("pattern") ?? "files"}`;
		case "ls":
			return `listing ${stringArg("path") ?? "files"}`;
		case "web_search":
			return "searching the web";
		case "agent_browser":
			return "using the browser";
		default:
			return `using ${toolName.replaceAll("_", " ")}`;
	}
}

function eventActivity(event: any): string | undefined {
	switch (event.type) {
		case "agent_start":
		case "turn_start":
			return "thinking…";
		case "message_update": {
			const updateType = event.assistantMessageEvent?.type;
			if (updateType === "thinking_start" || updateType === "thinking_delta") return "thinking…";
			if (updateType === "text_start" || updateType === "text_delta") return "responding…";
			if (updateType === "toolcall_start") {
				const toolName = event.assistantMessageEvent?.toolName;
				return toolName ? `preparing ${String(toolName).replaceAll("_", " ")}…` : "preparing a tool…";
			}
			return undefined;
		}
		case "tool_execution_start":
			return toolActivity(event.toolName ?? "tool", event.args);
		case "tool_execution_end":
			return event.isError ? `${event.toolName ?? "tool"} failed` : "thinking…";
		case "compaction_start":
			return "compacting context…";
		case "auto_retry_start":
			return "waiting to retry…";
		case "summarization_retry_scheduled":
			return "waiting to retry summarization…";
		case "agent_end":
			return event.willRetry ? "preparing to retry…" : "finishing…";
		default:
			return undefined;
	}
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
			const startedAt = Date.now();
			let lastEventAt = startedAt;
			let finishedAt: number | undefined;
			let activity = "starting…";
			let status: SubagentStatus = "running";
			let finalOutput = "";
			let stderr = "";
			let stopReason: string | undefined;

			const details = (output?: string): SubagentDetails => ({
				summary: oneLine(summary),
				task,
				messages: [...messages],
				startedAt,
				lastEventAt,
				finishedAt,
				activity,
				status,
				output,
			});
			const emitUpdate = () =>
				onUpdate?.({
					content: [{ type: "text", text: finalOutput || "Subagent is working…" }],
					details: details(),
				});

			emitUpdate();
			const refreshTimer = onUpdate ? setInterval(emitUpdate, 1_000) : undefined;
			refreshTimer?.unref();

			try {
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

						lastEventAt = Date.now();
						const nextActivity = eventActivity(event);
						const activityChanged = nextActivity !== undefined && nextActivity !== activity;
						if (nextActivity) activity = nextActivity;

						if (event.type === "message_end" && event.message) {
							const message = event.message as Message;
							messages.push(message);
							if (message.role === "assistant") {
								const text = getText(message);
								if (text) finalOutput = text;
								stopReason = message.stopReason;
							}
							emitUpdate();
						} else if (activityChanged) {
							emitUpdate();
						}
					};

					child.stdout.on("data", (chunk) => {
						stdoutBuffer += chunk.toString();
						const lines = stdoutBuffer.split("\n");
						stdoutBuffer = lines.pop() ?? "";
						for (const line of lines) processLine(line);
					});

					child.stderr.on("data", (chunk) => {
						lastEventAt = Date.now();
						stderr += chunk.toString();
					});

					const removeAbortListener = () => signal?.removeEventListener("abort", abort);
					child.on("error", (error) => {
						removeAbortListener();
						reject(error);
					});
					child.on("close", (code) => {
						removeAbortListener();
						if (stdoutBuffer.trim()) processLine(stdoutBuffer);
						if (aborted) reject(new Error("Subagent was aborted"));
						else resolve(code ?? 1);
					});

					function abort() {
						aborted = true;
						child.kill("SIGTERM");
						setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
					}

					if (signal?.aborted) abort();
					else signal?.addEventListener("abort", abort, { once: true });
				});

				finishedAt = Date.now();
				if (exitCode !== 0 || stopReason === "error") {
					throw new Error(stderr.trim() || finalOutput || `Subagent exited with code ${exitCode}`);
				}

				status = "completed";
				activity = "completed";
				const output = finalOutput || "Subagent completed without a text response.";
				return {
					content: [{ type: "text", text: truncateForModel(output) }],
					details: details(output),
				};
			} finally {
				if (refreshTimer) clearInterval(refreshTimer);
			}
		},

		renderCall(args, theme) {
			const summary = oneLine(args.summary || args.task || "Preparing delegated task…");
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", summary),
				0,
				0,
			);
		},

		renderResult(result, { isPartial }, theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details) {
				const content = result.content.find((part) => part.type === "text");
				return new Text(content?.text ?? "", 0, 0);
			}

			if (typeof details.startedAt !== "number" || typeof details.lastEventAt !== "number") {
				const content = result.content.find((part) => part.type === "text");
				return new Text(content?.text ?? details.output ?? "", 0, 0);
			}

			const now = details.finishedAt ?? Date.now();
			const elapsed = formatDuration(now - details.startedAt);
			if (isPartial || details.status === "running") {
				const quietFor = Date.now() - details.lastEventAt;
				let text = theme.fg("muted", `↳ ${elapsed} · ${details.activity}`);
				if (quietFor >= 15_000) {
					text += theme.fg("warning", ` · no updates ${formatDuration(quietFor)}`);
				}
				return new Text(text, 0, 0);
			}

			const output = result.content.find((part) => part.type === "text")?.text ?? details.output ?? "";
			return new Text(
				theme.fg("success", `✓ completed in ${elapsed}`) +
					(output ? `\n${theme.fg("toolOutput", output)}` : ""),
				0,
				0,
			);
		},
	});
}
