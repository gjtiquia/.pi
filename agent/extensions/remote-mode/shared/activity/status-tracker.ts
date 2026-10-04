import { commandLine, safeLine, duration } from "../../../remote-run/display.ts";

export type ActivityOutcome = "completed" | "aborted" | "error";

export interface ActiveToolStatus {
	id: string;
	name: string;
	args: Record<string, unknown> | undefined;
	startedAt: number;
	updatedAt: number;
	partialResult?: unknown;
}

export interface LastRunStatus {
	startedAt: number;
	finishedAt: number;
	outcome: ActivityOutcome;
}

export interface ActivitySnapshot {
	runStartedAt?: number;
	idleSince: number;
	phase: string;
	phaseStartedAt: number;
	lastProgressAt: number;
	activeTools: ActiveToolStatus[];
	lastRun?: LastRunStatus;
}

export class ActivityTracker {
	private runStartedAt: number | undefined;
	private idleSince: number;
	private phase = "idle";
	private phaseStartedAt: number;
	private lastProgressAt: number;
	private outcome: ActivityOutcome = "completed";
	private lastRun: LastRunStatus | undefined;
	private readonly activeTools = new Map<string, ActiveToolStatus>();

	constructor(now = Date.now()) {
		this.idleSince = now;
		this.phaseStartedAt = now;
		this.lastProgressAt = now;
	}

	reset(now = Date.now()): void {
		this.runStartedAt = undefined;
		this.idleSince = now;
		this.phase = "idle";
		this.phaseStartedAt = now;
		this.lastProgressAt = now;
		this.outcome = "completed";
		this.lastRun = undefined;
		this.activeTools.clear();
	}

	start(now = Date.now()): void {
		if (this.runStartedAt === undefined) {
			this.runStartedAt = now;
			this.outcome = "completed";
			this.activeTools.clear();
		}
		this.progress("thinking", now);
	}

	progress(phase: string, now = Date.now()): void {
		if (phase !== this.phase) {
			this.phase = phase;
			this.phaseStartedAt = now;
		}
		this.lastProgressAt = now;
	}

	startTool(id: string, name: string, args: Record<string, unknown> | undefined, now = Date.now()): void {
		this.activeTools.set(id, { id, name, args, startedAt: now, updatedAt: now });
		this.progress("executing tools", now);
	}

	updateTool(id: string, partialResult: unknown, now = Date.now()): void {
		const tool = this.activeTools.get(id);
		if (tool) {
			tool.updatedAt = now;
			tool.partialResult = partialResult;
		}
		this.progress("executing tools", now);
	}

	endTool(id: string, isError: boolean, now = Date.now()): void {
		this.activeTools.delete(id);
		if (isError) this.outcome = "error";
		this.progress(this.activeTools.size > 0 ? "executing tools" : "thinking", now);
	}

	setOutcome(outcome: ActivityOutcome): void {
		this.outcome = outcome;
	}

	settle(now = Date.now()): void {
		if (this.runStartedAt !== undefined) {
			this.lastRun = { startedAt: this.runStartedAt, finishedAt: now, outcome: this.outcome };
		}
		this.runStartedAt = undefined;
		this.idleSince = now;
		this.phase = "idle";
		this.phaseStartedAt = now;
		this.lastProgressAt = now;
		this.activeTools.clear();
	}

	snapshot(): ActivitySnapshot {
		return {
			runStartedAt: this.runStartedAt,
			idleSince: this.idleSince,
			phase: this.phase,
			phaseStartedAt: this.phaseStartedAt,
			lastProgressAt: this.lastProgressAt,
			activeTools: [...this.activeTools.values()].map((tool) => ({ ...tool })),
			lastRun: this.lastRun && { ...this.lastRun },
		};
	}
}

export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
	return `${totalSeconds}s`;
}

function stringArg(args: Record<string, unknown> | undefined, name: string): string | undefined {
	const value = args?.[name];
	return typeof value === "string" ? value : undefined;
}

export interface FormattedActivityUpdate {
	text: string;
	formatted: true;
}

export function markdownCodeBlock(text: string, language = ""): string {
	const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}${language}\n${text}\n${fence}`;
}

export function formatCommandActivity(
	toolName: "bash" | "powershell",
	command: string | undefined,
): FormattedActivityUpdate {
	if (command === undefined) return { text: `[running ${toolName}]`, formatted: true };
	return {
		text: `[running ${toolName}]\n${markdownCodeBlock(command, toolName === "bash" ? "sh" : "powershell")}`,
		formatted: true,
	};
}

function subagentSelection(partialResult?: unknown): string | undefined {
	const partial = partialResult as { details?: unknown } | undefined;
	const details = partial?.details;
	const data = typeof details === "object" && details !== null ? details as Record<string, unknown> : undefined;
	const provider = stringArg(data, "modelProvider");
	const id = stringArg(data, "modelId");
	const thinking = stringArg(data, "thinkingLevel");
	if (!provider || !id || !thinking) return undefined;
	return `${provider}/${id} · thinking: ${thinking}`;
}

export function formatSubagentActivity(args: Record<string, unknown> | undefined, partialResult?: unknown): string {
	const selection = subagentSelection(partialResult);
	if (!selection) return "";
	const summary = stringArg(args, "summary");
	return `waiting for subagent${summary ? ` — ${summary}` : ""} · model: ${selection}`;
}

function remoteRunDetails(result?: unknown): Record<string, unknown> | undefined {
	if (typeof result !== "object" || result === null) return;
	const details = (result as { details?: unknown }).details;
	return typeof details === "object" && details !== null && !Array.isArray(details)
		? details as Record<string, unknown> : undefined;
}

function remoteRunCommand(args: Record<string, unknown> | undefined, data?: Record<string, unknown>): string | undefined {
	const command = stringArg(data, "command");
	if (command) return safeLine(command);
	const argv = args?.args;
	if (Array.isArray(argv) && argv.length > 0 && argv.every(arg => typeof arg === "string")) {
		return commandLine(argv);
	}
}

export function formatRemoteRunActivity(
	args: Record<string, unknown> | undefined,
	result?: unknown,
	fallbackOutcome?: "completed" | "failed",
): string {
	const data = remoteRunDetails(result);
	const command = remoteRunCommand(args, data);
	const status = stringArg(data, "status");
	const final = status && status !== "running" ? status : fallbackOutcome;
	const phase = final ?? stringArg(data, "phase") ?? "starting";
	const parts = [`remote_run${command ? ` ${command}` : ""}`, safeLine(phase)];
	const jobId = stringArg(data, "jobId");
	const runner = stringArg(data, "runner");
	if (jobId) parts.push(safeLine(jobId));
	if (runner) parts.push(`runner: ${safeLine(runner)}`);
	if (final) {
		const exit = data?.exitCode;
		parts.push(`exit: ${typeof exit === "number" && Number.isFinite(exit) ? exit : "unknown"}`);
		const started = data?.startedAt;
		const finished = data?.finishedAt;
		if (typeof started === "number" && Number.isFinite(started) && typeof finished === "number" && Number.isFinite(finished)) {
			parts.push(duration(finished - started));
		}
	}
	return parts.join(" · ");
}

function toolLabel(tool: ActiveToolStatus): string {
	const args = tool.args;
	switch (tool.name) {
		case "read":
		case "write":
		case "edit":
			return `${tool.name} — ${stringArg(args, "path") ?? "a file"}`;
		case "web_search":
			return `web search — ${stringArg(args, "query") ?? "multiple queries"}`;
		case "agent_browser":
			return "browser";
		default:
			return tool.name.replaceAll("_", " ");
	}
}

function remoteRunLines(tool: ActiveToolStatus, now: number): string[] | undefined {
	if (tool.name !== "remote_run") return;
	const data = remoteRunDetails(tool.partialResult);
	const lines = [`Tool: remote_run (${formatDuration(now - tool.startedAt)})`];
	const command = remoteRunCommand(tool.args, data);
	if (command) lines.push(`Command: ${command}`);
	lines.push(`Remote phase: ${safeLine(stringArg(data, "phase") ?? "starting")}`);
	for (const [key, label] of [["jobId", "Job"], ["runner", "Runner"], ["outputPath", "Output"], ["diagnosticsPath", "Diagnostics"]]) {
		const value = stringArg(data, key);
		if (value) lines.push(`${label}: ${safeLine(value)}`);
	}
	return lines;
}

function subagentLines(tool: ActiveToolStatus, now: number): string[] | undefined {
	if (tool.name !== "subagent") return;
	const partial = tool.partialResult as { details?: unknown } | undefined;
	const details = partial?.details;
	if (typeof details !== "object" || details === null) return;
	const data = details as Record<string, unknown>;
	const summary = stringArg(tool.args, "summary") ?? stringArg(data, "summary");
	const lines = [`Tool: subagent${summary ? ` — ${summary}` : ""} (${formatDuration(now - tool.startedAt)})`];
	const selection = subagentSelection(tool.partialResult);
	if (selection) lines.push(`Child model: ${selection}`);
	if (typeof data.activity === "string") {
		const activityStartedAt = typeof data.activityStartedAt === "number" ? data.activityStartedAt : tool.updatedAt;
		lines.push(`Child activity (${formatDuration(now - activityStartedAt)}): ${data.activity}`);
	}
	if (typeof data.lastEventAt === "number") {
		let eventLine = `Child event: ${formatDuration(now - data.lastEventAt)} ago`;
		if (typeof data.stallTimeoutSeconds === "number") {
			const remaining = Math.max(0, Math.ceil(data.stallTimeoutSeconds - (now - data.lastEventAt) / 1000));
			eventLine += ` · stall timeout: ${data.stallTimeoutSeconds}s (${remaining}s remaining)`;
		}
		lines.push(eventLine);
	}
	if (typeof data.childSessionId === "string") lines.push(`Child session: ${data.childSessionId}`);
	return lines;
}

export interface StatusRenderOptions {
	idle: boolean;
	pendingMessages: boolean;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	compacting?: boolean;
	now?: number;
}

export function renderActivityStatus(snapshot: ActivitySnapshot, options: StatusRenderOptions): string {
	const now = options.now ?? Date.now();
	const lines: string[] = [];
	if (options.compacting) {
		lines.push("State: BUSY", "Phase: compacting context");
	} else if (options.idle) {
		lines.push(`State: IDLE for ${formatDuration(now - snapshot.idleSince)}`);
		if (snapshot.lastRun) {
			lines.push(
				`Last run: ${snapshot.lastRun.outcome} in ${formatDuration(snapshot.lastRun.finishedAt - snapshot.lastRun.startedAt)}`,
			);
		}
	} else if (snapshot.runStartedAt === undefined) {
		lines.push("State: BUSY", "Phase: background session operation (details unavailable)");
	} else {
		lines.push(`State: RUNNING for ${formatDuration(now - snapshot.runStartedAt)}`);
		lines.push(`Phase: ${snapshot.phase} for ${formatDuration(now - snapshot.phaseStartedAt)}`);
		lines.push(`Last progress: ${formatDuration(now - snapshot.lastProgressAt)} ago`);
	}

	for (const tool of snapshot.activeTools) {
		const detailed = remoteRunLines(tool, now) ?? subagentLines(tool, now);
		if (detailed) {
			lines.push(...detailed);
			continue;
		}
		lines.push(`Tool: ${toolLabel(tool)} (${formatDuration(now - tool.startedAt)})`);
		if (tool.name === "bash" || tool.name === "powershell") {
			const command = stringArg(tool.args, "command");
			if (command !== undefined) lines.push("Command:", markdownCodeBlock(command, tool.name === "bash" ? "sh" : "powershell"));
		}
	}

	lines.push(`Queued prompts: ${options.pendingMessages ? "yes" : "no"}`);
	if (options.model) {
		lines.push(`Model: ${options.model.provider}/${options.model.id}${options.thinkingLevel ? ` · ${options.thinkingLevel}` : ""}`);
	}
	return lines.join("\n");
}
