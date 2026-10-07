import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSupportedThinkingLevels, StringEnum, type Message } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getPackageDir,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	MODEL_TIER_VALUES, THINKING_LEVEL_VALUES, MODEL_TIER_DESCRIPTION, MODEL_DESCRIPTION,
	THINKING_LEVEL_DESCRIPTION, MODEL_SELECTION_GUIDANCE,
	resolveModelSelection, type ModelTier, type ThinkingLevel,
} from "../../preferences/model-tiers.ts";
import { selectionForResume } from "./model-selection.ts";
import { getPiInvocation } from "./invocation.ts";

const SUBAGENT_SESSION_ROOT_ENV = "PI_SUBAGENT_SESSION_ROOT";
const SUBAGENT_ROOT_SESSION_ID_ENV = "PI_SUBAGENT_ROOT_SESSION_ID";
const SUBAGENT_PARENT_SESSION_ID_ENV = "PI_SUBAGENT_PARENT_SESSION_ID";
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_SUMMARY_ENV = "PI_SUBAGENT_SUMMARY";
const SUBAGENT_ANCESTRY_ENV = "PI_SUBAGENT_ANCESTRY";
const DISCUSS_MODE_ENV = "PI_DISCUSS_MODE";
const MAX_SUBAGENT_DEPTH = 100;
const METADATA_DIRECTORY = ".metadata";

interface DelegationAncestor {
	sessionId: string;
	summary: string;
}

interface DelegationContext {
	rootSessionId?: string;
	parentSessionId?: string;
	depth: number;
	summary?: string;
	ancestry: DelegationAncestor[];
}

interface DelegationMetadata extends DelegationAncestor {
	version: 1;
	rootSessionId: string;
	parentSessionId: string;
	depth: number;
	sessionPath: string;
	ancestry: DelegationAncestor[];
	createdAt: string;
	modelTier?: ModelTier;
	modelProvider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
}

function getText(message: Message): string {
	if (message.role !== "assistant") return "";
	return message.content
		.filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function truncateForModel(text: string): { content: string; truncated: boolean } {
	return truncateHead(text, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
}

function finalOutputPath(sessionDir: string, sessionId: string): string {
	const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
	return path.join(sessionDir, `${safeId}.final-output.txt`);
}

function oneLine(text: string, maxLength = 120): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseDepth(value: string | undefined): number {
	if (!value) return 0;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseAncestry(value: string | undefined): DelegationAncestor[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry): DelegationAncestor[] => {
			if (
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.sessionId === "string" &&
				typeof entry.summary === "string"
			) {
				return [{ sessionId: entry.sessionId, summary: oneLine(entry.summary) }];
			}
			return [];
		});
	} catch {
		return [];
	}
}

function currentDelegationContext(): DelegationContext {
	return {
		rootSessionId: process.env[SUBAGENT_ROOT_SESSION_ID_ENV],
		parentSessionId: process.env[SUBAGENT_PARENT_SESSION_ID_ENV],
		depth: parseDepth(process.env[SUBAGENT_DEPTH_ENV]),
		summary: process.env[SUBAGENT_SUMMARY_ENV],
		ancestry: parseAncestry(process.env[SUBAGENT_ANCESTRY_ENV]),
	};
}

function delegationGuidance(context: DelegationContext): string {
	const position = `Subagent is available at delegation depth ${context.depth} of ${MAX_SUBAGENT_DEPTH}.`;
	const assignment = context.summary ? ` This session's assigned role is: ${oneLine(context.summary)}.` : "";
	const ancestry = context.ancestry.length > 0
		? ` Ancestor assignments: ${context.ancestry
				.map((ancestor, index) => `${index + 1}. ${oneLine(ancestor.summary, 90)}`)
				.join(" | ")}.`
		: "";
	return `${position}${assignment}${ancestry} Before calling subagent, decide whether the remaining work contains a distinct, independently useful task that is strictly narrower than this session's assignment. If the work is atomic, do it directly. Never delegate the whole assignment or recursively request another general review of it.`;
}

function metadataPath(sessionRoot: string, sessionId: string): string {
	const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
	return path.join(sessionRoot, METADATA_DIRECTORY, `${safeId}.json`);
}

function readDelegationMetadata(sessionRoot: string, sessionId: string): DelegationMetadata | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(metadataPath(sessionRoot, sessionId), "utf8"));
		if (
			parsed?.version !== 1 ||
			typeof parsed.sessionId !== "string" ||
			typeof parsed.rootSessionId !== "string" ||
			typeof parsed.parentSessionId !== "string" ||
			typeof parsed.depth !== "number" ||
			typeof parsed.summary !== "string" ||
			typeof parsed.sessionPath !== "string" ||
			!Array.isArray(parsed.ancestry) ||
			(parsed.modelTier !== undefined && typeof parsed.modelTier !== "string") ||
			(parsed.thinkingLevel !== undefined && !THINKING_LEVEL_VALUES.includes(parsed.thinkingLevel)) ||
			(parsed.modelProvider !== undefined && typeof parsed.modelProvider !== "string") ||
			(parsed.modelId !== undefined && typeof parsed.modelId !== "string")
		) return undefined;
		return parsed as DelegationMetadata;
	} catch {
		return undefined;
	}
}

function writeDelegationMetadata(sessionRoot: string, metadata: DelegationMetadata): void {
	const directory = path.join(sessionRoot, METADATA_DIRECTORY);
	fs.mkdirSync(directory, { recursive: true });
	const destination = metadataPath(sessionRoot, metadata.sessionId);
	const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	fs.renameSync(temporary, destination);
}

function descendantProcessIds(rootPid: number): number[] {
	if (process.platform === "win32") return [];
	try {
		const output = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
		const children = new Map<number, number[]>();
		for (const line of output.split("\n")) {
			const [pidText, parentText] = line.trim().split(/\s+/);
			const pid = Number(pidText);
			const parent = Number(parentText);
			if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
			const siblings = children.get(parent) ?? [];
			siblings.push(pid);
			children.set(parent, siblings);
		}
		const descendants: number[] = [];
		const visit = (pid: number) => {
			for (const child of children.get(pid) ?? []) {
				visit(child);
				descendants.push(child);
			}
		};
		visit(rootPid);
		return descendants;
	} catch {
		return [];
	}
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(pid, signal);
	} catch {
		// The process may already have exited.
	}
}

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals, ownsProcessGroup: boolean): void {
	if (!child.pid) return;
	if (process.platform === "win32") {
		const args = ["/pid", String(child.pid), "/T"];
		if (signal === "SIGKILL") args.push("/F");
		const killer = spawn("taskkill", args, { shell: false, stdio: "ignore" });
		killer.unref();
		return;
	}
	if (ownsProcessGroup) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall back to a process-tree snapshot.
		}
	}
	const descendants = descendantProcessIds(child.pid);
	signalProcess(child.pid, signal);
	for (const pid of descendants) signalProcess(pid, signal);
}

type SubagentStatus = "running" | "completed";

interface SubagentDetails {
	summary: string;
	task: string;
	modelTier?: ModelTier;
	modelProvider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	messages: Message[];
	startedAt: number;
	lastEventAt: number;
	finishedAt?: number;
	activity: string;
	activityStartedAt: number;
	status: SubagentStatus;
	stallTimeoutSeconds: number;
	childSessionId?: string;
	childSessionPath?: string;
	resumed: boolean;
	output?: string;
	finalOutputPath?: string;
}

function formatSessionId(details: SubagentDetails, theme: { fg: (color: "muted", text: string) => string }): string {
	return theme.fg("muted", `session id: ${details.childSessionId ?? "pending…"}`);
}

function formatModel(details: SubagentDetails, theme: { fg: (color: "muted" | "warning", text: string) => string }): string {
	const model = `${details.modelProvider}/${details.modelId}`;
	return theme.fg("muted", `model: ${model} · thinking: ${details.thinkingLevel}`);
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
		case "powershell": {
			const command = typeof input.command === "string" ? input.command : undefined;
			return `running ${command ?? toolName}`;
		}
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
		case "subagent": {
			const summary = stringArg("summary");
			return summary ? `waiting for subagent — ${summary}` : "waiting for subagent";
		}
		default:
			return `using ${toolName.replaceAll("_", " ")}`;
	}
}

function subagentSessionRoot(
	parentSessionFile: string | undefined,
	parentSessionId: string,
): string {
	const inheritedRoot = process.env[SUBAGENT_SESSION_ROOT_ENV];
	if (inheritedRoot) return path.resolve(inheritedRoot);

	if (parentSessionFile) {
		return path.join(path.dirname(parentSessionFile), "subagent-sessions", parentSessionId);
	}
	return path.join(getAgentDir(), "subagent-sessions", parentSessionId);
}

function findChildSessionPath(sessionDir: string, sessionId: string): string | undefined {
	try {
		const suffix = `_${sessionId}.jsonl`;
		const match = fs
			.readdirSync(sessionDir, { withFileTypes: true })
			.find((entry) => entry.isFile() && entry.name.endsWith(suffix));
		return match ? path.join(sessionDir, match.name) : undefined;
	} catch {
		return undefined;
	}
}

function sessionPathFromHeader(sessionDir: string, id: string, timestamp: string): string {
	return path.join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
}

function startsNewActivity(event: any): boolean {
	if (
		event.type === "agent_start" ||
		event.type === "turn_start" ||
		event.type === "tool_execution_start" ||
		event.type === "tool_execution_end" ||
		event.type === "compaction_start" ||
		event.type === "auto_retry_start" ||
		event.type === "summarization_retry_scheduled" ||
		event.type === "agent_end"
	) return true;

	if (event.type !== "message_update") return false;
	const updateType = event.assistantMessageEvent?.type;
	return updateType === "thinking_start" || updateType === "text_start" || updateType === "toolcall_start";
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
	const delegation = currentDelegationContext();
	if (delegation.depth >= MAX_SUBAGENT_DEPTH) return;

	const activeChildSessions = new Set<string>();

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		exposure: "model-only",
		description:
			`Delegate one strictly narrower task to a generic subagent in an isolated Pi process. Recursive delegation is available through depth ${MAX_SUBAGENT_DEPTH}; this session is at depth ${delegation.depth}. The child inherits the working directory and active tools, not model/thinking settings. Sessions are retained in one flat directory per root delegation tree. To continue a stopped session from this tree, provide its exact resumeSessionId and its original tier alone or an explicit model plus thinkingLevel matching its saved settings. Resuming a tier pins saved settings rather than re-routing the current preset. Multiple calls in one turn run in parallel; call subagent again after a result when later work depends on it.`,
		promptSnippet: "Delegate a distinct, strictly narrower task to one generic isolated subagent",
		promptGuidelines: [
			delegationGuidance(delegation),
			"Before delegating, state a bounded outcome and stopping condition in task. For coding tasks, explicitly assign verification ownership. As a child, report work beyond your assigned scope to the parent instead of expanding it. As a parent, coordinate combined checks to avoid duplicate verification and explain material scope expansion to the user before proceeding. Keep assignments proportional to the task.",
			"For every subagent call, write summary as a concise one-line description of the distinct, strictly narrower work being delegated.",
			...MODEL_SELECTION_GUIDANCE,
			"For every subagent call, deliberately choose stallTimeoutSeconds based on the longest legitimate period without JSON events expected for that task. Use longer timeouts for builds, tests, installations, or other potentially silent commands.",
			"Use resumeSessionId only to continue a subagent that has already stopped. If that continuation fails, launch a fresh subagent and include the failed session path plus instructions to inspect the existing working tree. Avoid unlimited retry loops.",
		],
		parameters: Type.Object({
			summary: Type.String({ description: "Concise one-line summary shown to the user" }),
			task: Type.String({ description: "The complete task to delegate" }),
			modelTier: Type.Optional(StringEnum(MODEL_TIER_VALUES, { description: MODEL_TIER_DESCRIPTION })),
			model: Type.Optional(Type.String({ description: MODEL_DESCRIPTION })),
			thinkingLevel: Type.Optional(StringEnum(THINKING_LEVEL_VALUES, { description: THINKING_LEVEL_DESCRIPTION })),
			stallTimeoutSeconds: Type.Integer({
				minimum: 25,
				description:
					"Seconds of continuous child inactivity before aborting it. Must be at least 25 seconds so the 15-second warning has a visible countdown. Choose deliberately based on the longest legitimate silent operation expected.",
			}),
			resumeSessionId: Type.Optional(
				Type.String({
					description:
						"Exact session ID of a stopped subagent in this root delegation tree. Continues that session instead of creating a new one.",
				}),
			),
		}),

		async execute(_toolCallId, { summary, task, modelTier, model, thinkingLevel, stallTimeoutSeconds, resumeSessionId }, signal, onUpdate, ctx) {
			if (!Number.isInteger(stallTimeoutSeconds) || stallTimeoutSeconds < 25) {
				throw new Error("stallTimeoutSeconds must be an integer of at least 25 seconds");
			}

			const parentSessionId = ctx.sessionManager.getSessionId();
			const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
			const sessionDir = subagentSessionRoot(parentSessionFile, parentSessionId);
			fs.mkdirSync(sessionDir, { recursive: true });

			const resumed = resumeSessionId !== undefined;
			let childSessionId = resumeSessionId;
			let childSessionPath = resumeSessionId
				? findChildSessionPath(sessionDir, resumeSessionId)
				: undefined;
			const resumedMetadata = resumeSessionId
				? readDelegationMetadata(sessionDir, resumeSessionId)
				: undefined;
			const rootSessionId = resumedMetadata?.rootSessionId ?? delegation.rootSessionId ?? parentSessionId;
			const childDepth = resumedMetadata?.depth ?? delegation.depth + 1;
			const childSummary = resumedMetadata?.summary ?? oneLine(summary);
			const childParentSessionId = resumedMetadata?.parentSessionId ?? parentSessionId;
			const childAncestry = resumedMetadata?.ancestry ?? [
				...delegation.ancestry,
				{
					sessionId: parentSessionId,
					summary: delegation.summary ? oneLine(delegation.summary) : "Root session",
				},
			];
			const requestedSelection = { model, modelTier, thinkingLevel };
			const selection = resumed ? selectionForResume(requestedSelection, resumedMetadata) : requestedSelection;
			const route = resolveModelSelection(selection, ctx.model, (provider, id) => {
				const selected = ctx.modelRegistry.getAvailable().find(candidate => candidate.provider === provider && candidate.id === id);
				return selected ? getSupportedThinkingLevels(selected) : undefined;
			});
			const resolvedModelTier = resumed ? resumedMetadata?.modelTier : modelTier;

			if (resumeSessionId && !childSessionPath) {
				throw new Error(
					`Cannot resume subagent session ${resumeSessionId}: no matching session belongs to this root delegation tree.`,
				);
			}
			if (resumeSessionId && activeChildSessions.has(resumeSessionId)) {
				throw new Error(`Cannot resume child session ${resumeSessionId}: it is already running.`);
			}
			if (resumeSessionId) activeChildSessions.add(resumeSessionId);

			const args = ["--mode", "json", "-p", "--session-dir", sessionDir];
			if (childSessionPath) args.push("--session", childSessionPath);
			else args.push("--name", `subagent: ${oneLine(summary, 80)}`);

			args.push("--model", `${route.provider}/${route.id}`, "--thinking", route.thinkingLevel);

			const discussBinding: { handlers: { status(ctx: ExtensionContext): string }[] } = { handlers: [] };
			pi.events.emit("pi:discuss-mode:bind:v1", discussBinding);
			const discussModeEnabled = discussBinding.handlers.length === 1
				? discussBinding.handlers[0]!.status(ctx) === "Discuss mode: on"
				: process.env[DISCUSS_MODE_ENV] === "1";
			const childTools = pi.getActiveTools().filter((name) => {
				if (childDepth >= MAX_SUBAGENT_DEPTH && name === "subagent") return false;
				if (discussModeEnabled && (name === "edit" || name === "write")) return false;
				return true;
			});
			if (childTools.length > 0) args.push("--tools", childTools.join(","));

			args.push(task);

			const invocation = getPiInvocation(args, getPackageDir());
			const childEnvironment = {
				...process.env,
				[DISCUSS_MODE_ENV]: discussModeEnabled ? "1" : "0",
				[SUBAGENT_SESSION_ROOT_ENV]: sessionDir,
				[SUBAGENT_ROOT_SESSION_ID_ENV]: rootSessionId,
				[SUBAGENT_PARENT_SESSION_ID_ENV]: childParentSessionId,
				[SUBAGENT_DEPTH_ENV]: String(childDepth),
				[SUBAGENT_SUMMARY_ENV]: childSummary,
				[SUBAGENT_ANCESTRY_ENV]: JSON.stringify(childAncestry),
			};
			const ownsProcessGroup = delegation.depth === 0 && process.platform !== "win32";
			const messages: Message[] = [];
			const startedAt = Date.now();
			let lastEventAt = startedAt;
			let finishedAt: number | undefined;
			let activity = resumed ? "resuming…" : "starting…";
			let activityStartedAt = startedAt;
			let status: SubagentStatus = "running";
			let finalOutput = "";
			let stderr = "";
			let stopReason: string | undefined;

			const details = (output?: string, savedFinalOutputPath?: string): SubagentDetails => ({
				summary: oneLine(summary),
				task,
				modelTier: resolvedModelTier,
				modelProvider: route.provider,
				modelId: route.id,
				thinkingLevel: route.thinkingLevel,
				messages: [...messages],
				startedAt,
				lastEventAt,
				finishedAt,
				activity,
				activityStartedAt,
				status,
				stallTimeoutSeconds,
				childSessionId,
				childSessionPath,
				resumed,
				output,
				finalOutputPath: savedFinalOutputPath,
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
						env: childEnvironment,
						detached: ownsProcessGroup,
						shell: false,
						stdio: ["ignore", "pipe", "pipe"],
					});

					let stdoutBuffer = "";
					let abortReason: "user" | "stall" | undefined;
					let activityBeforeStall: string | undefined;
					let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

					const processLine = (line: string) => {
						if (!line.trim()) return;

						let event: any;
						try {
							event = JSON.parse(line);
						} catch {
							return;
						}

						lastEventAt = Date.now();
						if (event.type === "session" && typeof event.id === "string") {
							childSessionId = event.id;
							if (!childSessionPath && typeof event.timestamp === "string") {
								childSessionPath = sessionPathFromHeader(sessionDir, event.id, event.timestamp);
							}
							activeChildSessions.add(event.id);
							if (!resumedMetadata && childSessionPath) {
								try {
									writeDelegationMetadata(sessionDir, {
										version: 1,
										sessionId: event.id,
										rootSessionId,
										parentSessionId: childParentSessionId,
										depth: childDepth,
										summary: childSummary,
										sessionPath: childSessionPath,
										ancestry: childAncestry,
										createdAt: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
										modelTier: resolvedModelTier,
										modelProvider: route.provider,
										modelId: route.id,
										thinkingLevel: route.thinkingLevel,
									});
								} catch (error) {
									stderr += `Failed to write subagent metadata: ${error instanceof Error ? error.message : String(error)}\n`;
								}
							}
						}
						const nextActivity = eventActivity(event);
						const activityChanged = nextActivity !== undefined && nextActivity !== activity;
						if (nextActivity) {
							if (activityChanged || startsNewActivity(event)) activityStartedAt = lastEventAt;
							activity = nextActivity;
						}

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
						stderr += chunk.toString();
					});

					const terminateChild = (reason: "user" | "stall") => {
						if (abortReason) return;
						abortReason = reason;
						if (reason === "stall") {
							activityBeforeStall = activity;
							activity = `stalled after ${stallTimeoutSeconds}s without updates`;
							emitUpdate();
						}
						terminateProcessTree(child, "SIGTERM", ownsProcessGroup);
						forceKillTimer = setTimeout(
							() => terminateProcessTree(child, "SIGKILL", ownsProcessGroup),
							5_000,
						);
						forceKillTimer.unref();
					};
					const abort = () => terminateChild("user");
					const stallCheckTimer = setInterval(() => {
						if (Date.now() - lastEventAt >= stallTimeoutSeconds * 1_000) terminateChild("stall");
					}, 1_000);
					stallCheckTimer.unref();
					const cleanup = () => {
						signal?.removeEventListener("abort", abort);
						clearInterval(stallCheckTimer);
						if (forceKillTimer && !abortReason) clearTimeout(forceKillTimer);
					};

					child.on("error", (error) => {
						cleanup();
						reject(error);
					});
					child.on("close", (code) => {
						cleanup();
						if (stdoutBuffer.trim()) processLine(stdoutBuffer);
						if (abortReason === "user") {
							reject(new Error("Subagent was aborted"));
						} else if (abortReason === "stall") {
							reject(
								new Error(
									`Subagent stalled: no JSON events for ${stallTimeoutSeconds}s. ` +
										`Runtime: ${formatDuration(Date.now() - startedAt)}. Last activity: ${activityBeforeStall ?? activity}.`,
								),
							);
						} else {
							resolve(code ?? 1);
						}
					});

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
				const truncated = truncateForModel(output);
				if (childSessionId && (!childSessionPath || !fs.existsSync(childSessionPath))) {
					childSessionPath = findChildSessionPath(sessionDir, childSessionId) ?? childSessionPath;
				}
				let savedFinalOutputPath: string | undefined;
				if (truncated.truncated) {
					savedFinalOutputPath = finalOutputPath(sessionDir, childSessionId ?? _toolCallId);
					fs.writeFileSync(savedFinalOutputPath, output, { encoding: "utf8", mode: 0o600 });
				}
				const recovery = [
					`Child session ID: ${childSessionId ?? "unavailable"}`,
					`Child session path: ${childSessionPath ?? "unavailable"}`,
					...(savedFinalOutputPath ? [
						`Output was truncated. Full final assistant response saved to ${savedFinalOutputPath}; use read on this file to inspect it.`,
					] : []),
				].join("\n");
				return {
					content: [
						{ type: "text", text: truncated.content },
						{ type: "text", text: recovery },
					],
					details: details(output, savedFinalOutputPath),
				};
			} catch (error) {
				finishedAt = Date.now();
				if (childSessionId && (!childSessionPath || !fs.existsSync(childSessionPath))) {
					childSessionPath = findChildSessionPath(sessionDir, childSessionId) ?? childSessionPath;
				}

				const message = error instanceof Error ? error.message : String(error);
				if (!childSessionId || !childSessionPath) throw error;
				throw new Error(
					`${message}\n\n` +
						`Child session ID: ${childSessionId}\n` +
						`Child session: ${childSessionPath}\n` +
						`Original task: ${oneLine(task, 300)}\n` +
						`Recovery: retry with resumeSessionId \"${childSessionId}\" after this child has stopped. ` +
						`If continuation fails, launch a fresh subagent that inspects this session and the existing working tree.`,
					{ cause: error },
				);
			} finally {
				if (refreshTimer) clearInterval(refreshTimer);
				if (childSessionId) activeChildSessions.delete(childSessionId);
			}
		},

		renderCall(args, theme) {
			const summary = oneLine(args.summary || args.task || "Preparing delegated task…");
			const resume = args.resumeSessionId
				? theme.fg("muted", ` [resume ${oneLine(args.resumeSessionId, 24)}]`)
				: "";
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", summary) + resume,
				0,
				0,
			);
		},

		renderResult(result, { isPartial, expanded }, theme) {
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
				const quietFor = now - details.lastEventAt;
				const activityStartedAt = typeof details.activityStartedAt === "number"
					? details.activityStartedAt
					: details.startedAt;
				const activityElapsed = formatDuration(now - activityStartedAt);
				let activityText = theme.fg("muted", `↳ ${elapsed} · ${details.activity}`);
				if (quietFor >= 15_000) {
					const stalledSeconds = Math.floor(quietFor / 1_000);
					const remainingSeconds =
						typeof details.stallTimeoutSeconds === "number"
							? Math.max(0, Math.ceil((details.stallTimeoutSeconds * 1_000 - quietFor) / 1_000))
							: undefined;
					const countdown = remainingSeconds === undefined ? "" : ` · auto-terminates in ${remainingSeconds}s`;
					activityText += theme.fg("warning", ` · stalled ${stalledSeconds}s${countdown}`);
				}

				activityText += theme.fg("muted", ` · ${activityElapsed}`);
				activityText += `\n${formatSessionId(details, theme)}`;
				activityText += `\n${formatModel(details, theme)}`;
				return new Text(activityText, 0, 0);
			}

			const output = result.content.find((part) => part.type === "text")?.text ?? details.output ?? "";
			const session = expanded && details.childSessionPath
				? `\n${theme.fg("dim", `session: ${details.childSessionPath}`)}`
				: "";
			const finalOutput = details.finalOutputPath
				? `\n${theme.fg("dim", `full response: ${details.finalOutputPath}`)}`
				: "";
			return new Text(
				theme.fg("success", `✓ completed in ${elapsed}`) +
					(output ? `\n${theme.fg("toolOutput", output)}` : "") +
					finalOutput +
					session +
					`\n${formatSessionId(details, theme)}` +
					`\n${formatModel(details, theme)}`,
				0,
				0,
			);
		},
	});
}
