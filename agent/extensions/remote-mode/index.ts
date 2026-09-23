import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { Type } from "typebox";

const STATE_TYPE = "remote-mode-thread";
const STATUS_KEY = "remote-mode";
const METADATA_TOOL_NAME = "remote_session_metadata";
const RECONNECT_DELAY_MS = 5_000;
const MAX_ACTIVITY_CHARS = 14_000;
const MAX_TITLE_CONTEXT_CHARS = 4_000;
const TITLE_MODELS: Readonly<Record<string, readonly string[]>> = {
	"openai-codex": ["gpt-5.3-codex-spark", "gpt-6-luna"],
	"opencode-go": ["deepseek-v4.1-flash", "glm-5.3-flash"],
};

interface Config {
	url: string;
	token: string;
	channelId: string;
}

interface ThreadState {
	sessionId: string;
	enabled?: boolean;
	rootPostId?: string;
	title?: string | null;
	titleSource?: "generated" | "manual";
	status?: "active" | "done";
	titleAttempted?: boolean;
}

interface MattermostPost {
	id: string;
	channel_id: string;
	user_id: string;
	root_id: string;
	message: string;
	props?: { from_bot?: string | boolean };
}

interface MattermostEvent {
	event?: string;
	data?: { post?: string };
	seq_reply?: number;
	status?: string;
	error?: { message?: string } | string;
}

interface ActivityRun {
	active: boolean;
	postId?: string;
	lines: string[];
	updates: Promise<void>;
}

function loadLocalEnv(): Error | undefined {
	try {
		process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), ".env"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return error as Error;
	}
}

function readConfig(): Config | undefined {
	const url = process.env.MATTERMOST_URL?.replace(/\/+$/, "");
	const token = process.env.MATTERMOST_BOT_TOKEN;
	const channelId = process.env.MATTERMOST_CHANNEL_ID;

	if (!url || !token || !channelId) return;
	return { url, token, channelId };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function oneLine(text: string, maxLength = 100): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function toolActivity(toolName: string, args: Record<string, unknown> | undefined): string {
	const input = args ?? {};
	const stringArg = (name: string): string | undefined =>
		typeof input[name] === "string" ? oneLine(input[name] as string, 80) : undefined;

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
		case "subagent": {
			const summary = stringArg("summary");
			return summary ? `waiting for subagent — ${summary}` : "waiting for subagent";
		}
		default:
			return `using ${toolName.replaceAll("_", " ")}`;
	}
}

export default function remoteModeExtension(pi: ExtensionAPI): void {
	const envError = loadLocalEnv();
	const config = readConfig();

	let enabled = false;
	let activationId = 0;
	let socket: WebSocket | undefined;
	let authenticated = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let operationController: AbortController | undefined;
	let context: ExtensionContext | undefined;
	let rootPostId: string | undefined;
	let rootPostPromise: Promise<string> | undefined;
	let rootPostUpdates: Promise<void> = Promise.resolve();
	let botUserId: string | undefined;
	let title: string | undefined;
	let titleSource: ThreadState["titleSource"];
	let threadStatus: NonNullable<ThreadState["status"]> = "active";
	let titleAttempted = false;
	let finalAssistantText: string | undefined;
	let assistantActivationId: number | undefined;
	let activityRun: ActivityRun | undefined;
	const activityRuns = new Set<ActivityRun>();

	function setStatus(ctx: ExtensionContext): void {
		let label: string | undefined;
		if (enabled) {
			label = authenticated ? "remote: connected" : "remote: connecting";
		}
		ctx.ui.setStatus(STATUS_KEY, label);
	}

	async function api<T>(
		path: string,
		init?: RequestInit,
		signal: AbortSignal | null | undefined = operationController?.signal,
	): Promise<T> {
		if (!config) throw new Error("Mattermost remote mode is not configured");
		const response = await fetch(`${config.url}/api/v4${path}`, {
			...init,
			signal,
			headers: {
				Authorization: `Bearer ${config.token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});

		if (!response.ok) {
			const detail = (await response.text()).trim();
			throw new Error(`Mattermost ${response.status}${detail ? `: ${detail}` : ""}`);
		}
		return (await response.json()) as T;
	}

	async function ensureBotUserId(): Promise<string> {
		if (botUserId) return botUserId;
		const user = await api<{ id: string }>("/users/me");
		botUserId = user.id;
		return botUserId;
	}

	function currentState(ctx: ExtensionContext): ThreadState {
		return {
			sessionId: ctx.sessionManager.getSessionId(),
			enabled,
			rootPostId,
			title: title ?? null,
			titleSource,
			status: threadStatus,
			titleAttempted,
		};
	}

	function persistState(ctx: ExtensionContext): void {
		pi.appendEntry<ThreadState>(STATE_TYPE, currentState(ctx));
	}

	function renderRootPost(ctx: ExtensionContext): string {
		const emoji = threadStatus === "done" ? "✅" : "💬";
		return `${emoji} Project: ${basename(ctx.cwd)}\nTitle: ${title ?? "(pending)"}\nSession ID: ${ctx.sessionManager.getSessionId()}`;
	}

	async function ensureRootPost(ctx: ExtensionContext): Promise<string> {
		if (rootPostId) return rootPostId;
		if (rootPostPromise) return rootPostPromise;

		const targetSessionId = ctx.sessionManager.getSessionId();
		const pending = (async () => {
			if (!config) throw new Error("Mattermost remote mode is not configured");
			// Do not abort root creation when remote mode is toggled off. If Mattermost
			// accepts the post, retaining its ID prevents a second thread on re-enable.
			const post = await api<MattermostPost>(
				"/posts",
				{
					method: "POST",
					body: JSON.stringify({ channel_id: config.channelId, message: renderRootPost(ctx) }),
				},
				null,
			);
			if (ctx.sessionManager.getSessionId() === targetSessionId) {
				rootPostId = post.id;
				pi.appendEntry<ThreadState>(STATE_TYPE, { sessionId: targetSessionId, rootPostId: post.id });
			}
			return post.id;
		})();
		rootPostPromise = pending;
		const clearPending = () => {
			if (rootPostPromise === pending) rootPostPromise = undefined;
		};
		void pending.then(clearPending, clearPending);

		return pending;
	}

	function patchRootPost(ctx: ExtensionContext, create = true): Promise<void> {
		const targetSessionId = ctx.sessionManager.getSessionId();
		const update = rootPostUpdates.catch(() => {}).then(async () => {
			if (ctx.sessionManager.getSessionId() !== targetSessionId) return;
			const postId = rootPostId ?? (create ? await ensureRootPost(ctx) : undefined);
			if (!postId || ctx.sessionManager.getSessionId() !== targetSessionId) return;
			await api<MattermostPost>(
				`/posts/${postId}/patch`,
				{ method: "PUT", body: JSON.stringify({ message: renderRootPost(ctx) }) },
				null,
			);
		});
		rootPostUpdates = update;
		return update;
	}

	function messageText(message: { content: unknown }): string {
		if (typeof message.content === "string") return message.content.trim();
		if (!Array.isArray(message.content)) return "";
		return message.content
			.filter((block): block is { type: "text"; text: string } =>
				typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
			)
			.map((block) => block.text)
			.join("\n")
			.trim();
	}

	function titleContext(ctx: ExtensionContext, triggeringText: string): string {
		const messages: string[] = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) continue;
			const text = messageText(entry.message);
			if (text) messages.push(`${entry.message.role === "user" ? "User" : "Assistant"}: ${text}`);
		}
		const trigger = `User: ${triggeringText}`;
		if (messages.at(-1) !== trigger) messages.push(trigger);
		return messages.join("\n\n").slice(-MAX_TITLE_CONTEXT_CHARS);
	}

	async function generateTitle(
		ctx: ExtensionContext,
		targetSessionId: string,
		targetActivationId: number,
		triggeringText: string,
	): Promise<void> {
		titleAttempted = true;
		persistState(ctx);
		const provider = ctx.model?.provider;
		const candidates = provider ? TITLE_MODELS[provider] : undefined;
		if (!provider || !candidates) {
			ctx.ui.notify(`No approved remote title model is configured for ${provider ?? "the active provider"}`, "warning");
			return;
		}
		const models = candidates
			.map((id) => ctx.modelRegistry.find(provider, id))
			.filter((item): item is Exclude<typeof item, undefined> =>
				item !== undefined && ctx.modelRegistry.hasConfiguredAuth(item),
			);
		if (models.length === 0) {
			ctx.ui.notify(`No approved remote title model is available for ${provider}`, "warning");
			return;
		}

		const transcript = titleContext(ctx, triggeringText);
		const failures: string[] = [];
		for (const model of models) {
			if (
				ctx.sessionManager.getSessionId() !== targetSessionId || activationId !== targetActivationId ||
				!enabled || titleSource !== undefined
			) return;
			try {
				const outputController = new AbortController();
				const signals = [outputController.signal, AbortSignal.timeout(15_000)];
				if (operationController) signals.push(operationController.signal);
				const stream = ctx.modelRegistry.streamSimple(
					model,
					{
						systemPrompt: "Create a concise 3-8 word title for this coding conversation. Return only the title, with no quotes or punctuation wrapper.",
						messages: [{ role: "user", content: transcript, timestamp: Date.now() }],
						tools: [],
					},
					{ maxTokens: 24, reasoning: "minimal", signal: AbortSignal.any(signals) },
				);
				let streamedTextLength = 0;
				for await (const event of stream) {
					if (event.type !== "text_delta") continue;
					streamedTextLength += event.delta.length;
					if (streamedTextLength > 160) outputController.abort();
				}
				const result = await stream.result();
				const generated = oneLine(
					result.content.filter((block) => block.type === "text").map((block) => block.text).join(" "),
					100,
				)
					.replace(/^["'`]+|["'`]+$/g, "")
					.trim();
				const wordCount = generated.split(/\s+/).filter(Boolean).length;
				if (
					result.stopReason === "error" || result.stopReason === "aborted" ||
					!generated || wordCount < 3 || wordCount > 8
				) {
					failures.push(`${model.id}: ${result.errorMessage ?? "invalid title response"}`);
					continue;
				}
				if (
					ctx.sessionManager.getSessionId() !== targetSessionId || activationId !== targetActivationId ||
					!enabled || titleSource !== undefined
				) return;
				title = generated;
				titleSource = "generated";
				pi.setSessionName(generated);
				persistState(ctx);
				try {
					await patchRootPost(ctx);
				} catch (error) {
					ctx.ui.notify(`Could not update Mattermost session title: ${errorMessage(error)}`, "warning");
				}
				return;
			} catch (error) {
				failures.push(`${model.id}: ${errorMessage(error)}`);
			}
		}
		if (
			ctx.sessionManager.getSessionId() !== targetSessionId || activationId !== targetActivationId ||
			!enabled || titleSource !== undefined
		) return;
		ctx.ui.notify(`Could not generate remote session title (${failures.join("; ")})`, "warning");
	}

	function setMetadataToolEnabled(toolEnabled: boolean): void {
		const active = pi.getActiveTools().filter((name) => name !== METADATA_TOOL_NAME);
		pi.setActiveTools(toolEnabled ? [...active, METADATA_TOOL_NAME] : active);
	}

	function scheduleReconnect(ctx: ExtensionContext): void {
		if (!enabled || reconnectTimer) return;
		setStatus(ctx);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			void connect(ctx);
		}, RECONNECT_DELAY_MS);
	}

	function resetActivity(): void {
		for (const run of activityRuns) run.active = false;
		activityRuns.clear();
		activityRun = undefined;
	}

	function updateActivity(activity: string, ctx: ExtensionContext, run = activityRun): Promise<void> {
		if (!run || !run.active || !activityRuns.has(run) || !enabled || !config) {
			return run?.updates ?? Promise.resolve();
		}
		const line = `[${activity}]`;
		if (line === run.lines.at(-1)) return run.updates;
		run.lines.push(line);
		let omitted = false;
		while (run.lines.join("\n").length > MAX_ACTIVITY_CHARS && run.lines.length > 1) {
			run.lines.shift();
			omitted = true;
		}
		if (omitted) {
			run.lines.unshift("[earlier activity omitted…]");
			while (run.lines.join("\n").length > MAX_ACTIVITY_CHARS && run.lines.length > 2) {
				run.lines.splice(1, 1);
			}
		}
		const message = run.lines.join("\n");
		const targetActivationId = activationId;

		run.updates = run.updates
			.then(async () => {
				if (!run.active || !activityRuns.has(run) || !enabled || activationId !== targetActivationId) return;
				const rootId = await ensureRootPost(ctx);
				if (!run.active || !activityRuns.has(run) || !enabled || activationId !== targetActivationId) return;

				if (!run.postId) {
					const post = await api<MattermostPost>("/posts", {
						method: "POST",
						body: JSON.stringify({ channel_id: config.channelId, root_id: rootId, message }),
					});
					if (run.active && activityRuns.has(run) && enabled && activationId === targetActivationId) {
						run.postId = post.id;
					}
					return;
				}

				await api<MattermostPost>(`/posts/${run.postId}/patch`, {
					method: "PUT",
					body: JSON.stringify({ message }),
				});
			})
			.catch((error) => {
				if (run.active && activityRuns.has(run) && enabled && activationId === targetActivationId) {
					if ((error as Error).name !== "AbortError") {
						ctx.ui.notify(`Could not update Mattermost activity: ${errorMessage(error)}`, "warning");
					}
					run.active = false;
					activityRuns.delete(run);
					if (activityRun === run) activityRun = undefined;
				}
			});

		return run.updates;
	}

	function startActivity(ctx: ExtensionContext): void {
		if (!activityRun) {
			activityRun = { active: true, lines: [], updates: Promise.resolve() };
			activityRuns.add(activityRun);
		}
		void updateActivity("thinking…", ctx);
	}

	async function completeActivity(run: ActivityRun, ctx: ExtensionContext): Promise<void> {
		if (activityRun === run) activityRun = undefined;
		await updateActivity("completed", ctx, run);
		run.active = false;
		activityRuns.delete(run);
	}

	async function handlePostedEvent(event: MattermostEvent, ctx: ExtensionContext): Promise<void> {
		if (!enabled || event.event !== "posted" || !event.data?.post || !config || !rootPostId) return;

		let post: MattermostPost;
		try {
			post = JSON.parse(event.data.post) as MattermostPost;
		} catch {
			return;
		}

		if (
			post.channel_id !== config.channelId ||
			post.root_id !== rootPostId ||
			post.user_id === botUserId ||
			post.props?.from_bot === true ||
			post.props?.from_bot === "true" ||
			!post.message.trim()
		) {
			return;
		}

		if (ctx.isIdle()) pi.sendUserMessage(post.message);
		else pi.sendUserMessage(post.message, { deliverAs: "followUp" });
	}

	async function connect(ctx: ExtensionContext): Promise<void> {
		if (!enabled || !config || socket) return;

		try {
			await Promise.all([patchRootPost(ctx), ensureBotUserId()]);
			if (!enabled || socket) return;

			const websocketUrl = new URL(`${config.url}/api/v4/websocket`);
			websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
			const currentSocket = new WebSocket(websocketUrl);
			socket = currentSocket;
			authenticated = false;
			setStatus(ctx);

			currentSocket.addEventListener("open", () => {
				if (!enabled || socket !== currentSocket) return;
				currentSocket.send(
					JSON.stringify({
						seq: 1,
						action: "authentication_challenge",
						data: { token: config.token },
					}),
				);
				setStatus(ctx);
			});

			currentSocket.addEventListener("message", (message) => {
				if (!enabled || socket !== currentSocket || typeof message.data !== "string") return;
				try {
					const event = JSON.parse(message.data) as MattermostEvent;
					if (event.seq_reply === 1) {
						if (event.status === "OK") {
							authenticated = true;
							setStatus(ctx);
						} else {
							const detail = typeof event.error === "string" ? event.error : event.error?.message;
							ctx.ui.notify(`Mattermost authentication failed${detail ? `: ${detail}` : ""}`, "warning");
							currentSocket.close();
						}
						return;
					}
					void handlePostedEvent(event, ctx).catch((error) => {
						ctx.ui.notify(`Remote message failed: ${errorMessage(error)}`, "warning");
					});
				} catch {
					// Ignore malformed and non-JSON websocket messages.
				}
			});

			currentSocket.addEventListener("error", () => {
				if (socket === currentSocket) currentSocket.close();
			});

			currentSocket.addEventListener("close", () => {
				if (socket !== currentSocket) return;
				socket = undefined;
				authenticated = false;
				if (enabled) scheduleReconnect(ctx);
				else setStatus(ctx);
			});
		} catch (error) {
			if (enabled && (error as Error).name !== "AbortError") {
				ctx.ui.notify(`Mattermost connection failed: ${errorMessage(error)}`, "warning");
				scheduleReconnect(ctx);
			}
		}
	}

	function disconnect(ctx?: ExtensionContext): void {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = undefined;
		operationController?.abort();
		operationController = undefined;
		const currentSocket = socket;
		socket = undefined;
		authenticated = false;
		currentSocket?.close();
		if (ctx) setStatus(ctx);
	}

	function enable(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.notify("Remote mode is already enabled", "info");
			return;
		}
		if (envError) {
			ctx.ui.notify(`Could not load remote-mode/.env: ${envError.message}`, "error");
			return;
		}
		if (!config) {
			ctx.ui.notify(
				"Remote mode needs MATTERMOST_URL, MATTERMOST_BOT_TOKEN, and MATTERMOST_CHANNEL_ID",
				"error",
			);
			return;
		}

		enabled = true;
		activationId += 1;
		operationController = new AbortController();
		persistState(ctx);
		setMetadataToolEnabled(true);
		setStatus(ctx);
		void connect(ctx);
		ctx.ui.notify("Remote mode enabled", "info");
	}

	function disable(ctx: ExtensionContext): void {
		enabled = false;
		activationId += 1;
		finalAssistantText = undefined;
		assistantActivationId = undefined;
		resetActivity();
		persistState(ctx);
		setMetadataToolEnabled(false);
		disconnect(ctx);
		ctx.ui.notify("Remote mode disabled", "info");
	}

	pi.registerCommand("remote", {
		description: "Control Mattermost remote mode (on, off, status, ping)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "status") {
				const connection = authenticated ? "connected" : "disconnected";
				ctx.ui.notify(`Remote mode is ${enabled ? `enabled (${connection})` : "disabled"}`, "info");
				return;
			}
			if (action === "ping") {
				if (envError) {
					ctx.ui.notify(`Could not load remote-mode/.env: ${envError.message}`, "error");
					return;
				}
				if (!config) {
					ctx.ui.notify(
						"Remote mode needs MATTERMOST_URL, MATTERMOST_BOT_TOKEN, and MATTERMOST_CHANNEL_ID",
						"error",
					);
					return;
				}
				try {
					const rootId = await ensureRootPost(ctx);
					await api<MattermostPost>("/posts", {
						method: "POST",
						body: JSON.stringify({ channel_id: config.channelId, root_id: rootId, message: "ping" }),
					});
					ctx.ui.notify("Ping sent to Mattermost", "info");
				} catch (error) {
					ctx.ui.notify(`Mattermost ping failed: ${errorMessage(error)}`, "error");
				}
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /remote [on|off|status|ping]", "warning");
				return;
			}
			if (action === "on" || (!action && !enabled)) enable(ctx);
			else disable(ctx);
		},
	});

	pi.registerTool({
		name: METADATA_TOOL_NAME,
		label: "Remote session metadata",
		description: "Rename the current Mattermost remote session or mark it in progress/done when the user asks.",
		promptSnippet: "Update the current Mattermost remote session title or active/done status",
		promptGuidelines: [
			"Use remote_session_metadata when the user asks to rename the current remote session or mark it done or back in progress.",
		],
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "New short session title" })),
			status: Type.Optional(StringEnum(["active", "done"] as const, {
				description: "Whether the remote session is in progress or done",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!enabled) throw new Error("Mattermost remote mode is not enabled");
			if (params.title === undefined && params.status === undefined) {
				throw new Error("Provide a title, status, or both");
			}
			if (params.title !== undefined) {
				const manualTitle = oneLine(params.title, 100);
				if (!manualTitle) throw new Error("The remote session title cannot be empty");
				title = manualTitle;
				titleSource = "manual";
				pi.setSessionName(manualTitle);
			}
			if (params.status !== undefined) threadStatus = params.status;
			persistState(ctx);
			await patchRootPost(ctx);
			return {
				content: [{
					type: "text",
					text: `Remote session updated: ${threadStatus === "done" ? "done" : "in progress"}, title “${title ?? "(pending)"}”.`,
				}],
				details: { title: title ?? null, status: threadStatus },
			};
		},
	});

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		enabled = false;
		rootPostId = undefined;
		rootPostPromise = undefined;
		rootPostUpdates = Promise.resolve();
		title = undefined;
		titleSource = undefined;
		threadStatus = "active";
		titleAttempted = false;
		const sessionId = ctx.sessionManager.getSessionId();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			const data = entry.data;
			if (typeof data !== "object" || data === null) continue;
			const state = data as Partial<ThreadState>;
			if (state.sessionId !== sessionId) continue;
			if (typeof state.enabled === "boolean") enabled = state.enabled;
			if (typeof state.rootPostId === "string" && state.rootPostId) rootPostId = state.rootPostId;
			if (state.title === null) {
				title = undefined;
				titleSource = undefined;
			} else if (typeof state.title === "string" && state.title.trim()) {
				title = state.title;
			}
			if (state.titleSource === "generated" || state.titleSource === "manual") titleSource = state.titleSource;
			if (state.status === "active" || state.status === "done") threadStatus = state.status;
			if (typeof state.titleAttempted === "boolean") titleAttempted = state.titleAttempted;
		}
		const sessionName = pi.getSessionName();
		if (sessionName && sessionName !== title) {
			title = sessionName;
			titleSource = "manual";
		}
		setMetadataToolEnabled(enabled);
		if (enabled && !envError && config) {
			activationId += 1;
			operationController = new AbortController();
			void connect(ctx);
		}
		setStatus(ctx);
	});

	pi.on("session_info_changed", (event, ctx) => {
		const nextTitle = event.name?.trim() || undefined;
		if (nextTitle === title) return;
		title = nextTitle;
		titleSource = "manual";
		persistState(ctx);
		if (rootPostId) {
			void patchRootPost(ctx, false).catch((error) => {
				ctx.ui.notify(`Could not update Mattermost session title: ${errorMessage(error)}`, "warning");
			});
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		finalAssistantText = undefined;
		assistantActivationId = enabled ? activationId : undefined;
		void updateActivity("thinking…", ctx);
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "user") return;
		const text = messageText(event.message);
		if (enabled && title === undefined && titleSource === undefined && !titleAttempted && text) {
			void generateTitle(ctx, ctx.sessionManager.getSessionId(), activationId, text);
		}
		if (!enabled) return;
		if (activityRun) await completeActivity(activityRun, ctx);
		startActivity(ctx);
	});

	pi.on("message_update", (event, ctx) => {
		const updateType = event.assistantMessageEvent.type;
		if (updateType === "thinking_start") void updateActivity("thinking…", ctx);
		else if (updateType === "text_start") void updateActivity("responding…", ctx);
		else if (updateType === "toolcall_start") {
			const block = event.assistantMessageEvent.partial.content[event.assistantMessageEvent.contentIndex];
			const toolName = block?.type === "toolCall" ? block.name : undefined;
			void updateActivity(toolName ? `preparing ${toolName.replaceAll("_", " ")}…` : "preparing a tool…", ctx);
		}
	});

	pi.on("tool_execution_start", (event, ctx) => {
		void updateActivity(toolActivity(event.toolName, event.args), ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		void updateActivity("thinking…", ctx);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		finalAssistantText = event.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const text = finalAssistantText;
		const responseActivationId = assistantActivationId;
		const settledActivity = activityRun;
		finalAssistantText = undefined;
		assistantActivationId = undefined;
		if (settledActivity) await completeActivity(settledActivity, ctx);
		if (!enabled || !config || !text || responseActivationId === undefined) return;

		try {
			const rootId = await ensureRootPost(ctx);
			if (!enabled || activationId !== responseActivationId) return;
			await api<MattermostPost>("/posts", {
				method: "POST",
				body: JSON.stringify({ channel_id: config.channelId, root_id: rootId, message: text }),
			});
		} catch (error) {
			if (enabled && (error as Error).name !== "AbortError") {
				ctx.ui.notify(`Could not mirror response to Mattermost: ${errorMessage(error)}`, "warning");
			}
		}
	});

	pi.on("session_shutdown", () => {
		enabled = false;
		activationId += 1;
		finalAssistantText = undefined;
		assistantActivationId = undefined;
		resetActivity();
		setMetadataToolEnabled(false);
		disconnect(context);
		context = undefined;
	});
}
