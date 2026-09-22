import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const STATE_TYPE = "remote-mode-thread";
const STATUS_KEY = "remote-mode";
const RECONNECT_DELAY_MS = 5_000;

interface Config {
	url: string;
	token: string;
	channelId: string;
	allowedUserId: string;
}

interface ThreadState {
	sessionId: string;
	enabled?: boolean;
	rootPostId?: string;
}

interface MattermostPost {
	id: string;
	channel_id: string;
	user_id: string;
	root_id: string;
	message: string;
}

interface MattermostEvent {
	event?: string;
	data?: { post?: string };
	seq_reply?: number;
	status?: string;
	error?: { message?: string } | string;
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
	const allowedUserId = process.env.MATTERMOST_ALLOWED_USER_ID;

	if (!url || !token || !channelId || !allowedUserId) return;
	return { url, token, channelId, allowedUserId };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
	let botUserId: string | undefined;
	let finalAssistantText: string | undefined;
	let assistantActivationId: number | undefined;

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

	async function ensureRootPost(ctx: ExtensionContext): Promise<string> {
		if (rootPostId) return rootPostId;
		if (rootPostPromise) return rootPostPromise;

		const sessionId = ctx.sessionManager.getSessionId();
		const pending = (async () => {
			if (!config) throw new Error("Mattermost remote mode is not configured");
			// Do not abort root creation when remote mode is toggled off. If Mattermost
			// accepts the post, retaining its ID prevents a second thread on re-enable.
			const post = await api<MattermostPost>(
				"/posts",
				{
					method: "POST",
					body: JSON.stringify({
						channel_id: config.channelId,
						message: `Pi remote session ${sessionId}\nProject: ${ctx.cwd}`,
					}),
				},
				null,
			);
			rootPostId = post.id;
			pi.appendEntry<ThreadState>(STATE_TYPE, { sessionId, rootPostId: post.id });
			return post.id;
		})();
		rootPostPromise = pending;
		const clearPending = () => {
			if (rootPostPromise === pending) rootPostPromise = undefined;
		};
		void pending.then(clearPending, clearPending);

		return pending;
	}

	function scheduleReconnect(ctx: ExtensionContext): void {
		if (!enabled || reconnectTimer) return;
		setStatus(ctx);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			void connect(ctx);
		}, RECONNECT_DELAY_MS);
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
			post.user_id !== config.allowedUserId ||
			post.user_id === botUserId ||
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
			await Promise.all([ensureRootPost(ctx), ensureBotUserId()]);
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
				"Remote mode needs MATTERMOST_URL, MATTERMOST_BOT_TOKEN, MATTERMOST_CHANNEL_ID, and MATTERMOST_ALLOWED_USER_ID",
				"error",
			);
			return;
		}

		enabled = true;
		activationId += 1;
		operationController = new AbortController();
		pi.appendEntry<ThreadState>(STATE_TYPE, {
			sessionId: ctx.sessionManager.getSessionId(),
			enabled,
		});
		setStatus(ctx);
		void connect(ctx);
		ctx.ui.notify("Remote mode enabled", "info");
	}

	function disable(ctx: ExtensionContext): void {
		enabled = false;
		activationId += 1;
		finalAssistantText = undefined;
		assistantActivationId = undefined;
		pi.appendEntry<ThreadState>(STATE_TYPE, {
			sessionId: ctx.sessionManager.getSessionId(),
			enabled,
		});
		disconnect(ctx);
		ctx.ui.notify("Remote mode disabled", "info");
	}

	pi.registerCommand("remote", {
		description: "Toggle Mattermost remote mode (on, off, status)",
		handler: (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "status") {
				const connection = authenticated ? "connected" : "disconnected";
				ctx.ui.notify(`Remote mode is ${enabled ? `enabled (${connection})` : "disabled"}`, "info");
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /remote [on|off|status]", "warning");
				return;
			}
			if (action === "on" || (!action && !enabled)) enable(ctx);
			else disable(ctx);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		enabled = false;
		rootPostId = undefined;
		const sessionId = ctx.sessionManager.getSessionId();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			const state = entry.data as ThreadState | undefined;
			if (state?.sessionId !== sessionId) continue;
			if (state.enabled !== undefined) enabled = state.enabled;
			if (state.rootPostId !== undefined) rootPostId = state.rootPostId;
		}
		if (enabled && !envError && config) {
			activationId += 1;
			operationController = new AbortController();
			void connect(ctx);
		}
		setStatus(ctx);
	});

	pi.on("agent_start", () => {
		finalAssistantText = undefined;
		assistantActivationId = enabled ? activationId : undefined;
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
		finalAssistantText = undefined;
		assistantActivationId = undefined;
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
		disconnect(context);
		context = undefined;
	});
}
