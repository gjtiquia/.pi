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

function oneLine(text: string, maxLength = 120): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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
	maxCommandChars = 13_000,
): FormattedActivityUpdate {
	if (command === undefined) return { text: `[running ${toolName}]`, formatted: true };
	const omitted = Math.max(0, command.length - maxCommandChars);
	const displayed = omitted > 0 ? command.slice(0, maxCommandChars) : command;
	const truncation = omitted > 0
		? `\n[${omitted} command characters omitted only because Mattermost activity posts are size-limited]`
		: "";
	return {
		text: `[running ${toolName}]\n${markdownCodeBlock(displayed, toolName === "bash" ? "sh" : "powershell")}${truncation}`,
		formatted: true,
	};
}

function toolLabel(tool: ActiveToolStatus): string {
	const args = tool.args;
	switch (tool.name) {
		case "read":
		case "write":
		case "edit":
			return `${tool.name} — ${oneLine(stringArg(args, "path") ?? "a file")}`;
		case "web_search":
			return `web search — ${oneLine(stringArg(args, "query") ?? "multiple queries")}`;
		case "agent_browser":
			return "browser";
		default:
			return tool.name.replaceAll("_", " ");
	}
}

function subagentLines(tool: ActiveToolStatus, now: number): string[] | undefined {
	if (tool.name !== "subagent") return;
	const partial = tool.partialResult as { details?: unknown } | undefined;
	const details = partial?.details;
	if (typeof details !== "object" || details === null) return;
	const data = details as Record<string, unknown>;
	const summary = typeof data.summary === "string" ? data.summary : stringArg(tool.args, "summary");
	const lines = [`Tool: subagent${summary ? ` — ${summary}` : ""} (${formatDuration(now - tool.startedAt)})`];
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
		const subagent = subagentLines(tool, now);
		if (subagent) {
			lines.push(...subagent);
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
