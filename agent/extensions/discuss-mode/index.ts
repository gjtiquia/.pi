import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DISCUSS_MODE_STATE_TYPE = "discuss-mode-state";
const DISCUSS_MODE_ENV = "PI_DISCUSS_MODE";
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const BIND_CHANNEL = "pi:discuss-mode:bind:v1";

const DISCUSS_MODE_CHANGED_MESSAGE = `Discuss mode changed. Call discuss_mode_status before continuing. Use the result instead of any earlier discuss-mode instructions or status results.

- If on: Discuss, analyze, and inspect only. Read-only tool use is allowed. Do not use any tool to make changes.
- If off: Follow normal session instructions.`;

export default function discussModeExtension(pi: ExtensionAPI): void {
	const isSubagent = process.env[SUBAGENT_DEPTH_ENV] !== undefined;
	const inheritedMode = process.env[DISCUSS_MODE_ENV] === "1";
	// Each extension runtime owns one session. Never use process.env as live state:
	// the gateway runs several sessions (and their tool calls) in one process.
	let enabled = false;
	const status = (ctx: ExtensionContext) => {
		restoreMode(ctx, "startup");
		return `Discuss mode: ${enabled ? "on" : "off"}`;
	};

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus("discuss-mode", enabled ? "💬 discuss" : undefined);
	}

	function restoreMode(ctx: ExtensionContext, reason: string): void {
		const sessionId = ctx.sessionManager.getSessionId();
		let restored: boolean | undefined;
		let branchMode: boolean | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== DISCUSS_MODE_STATE_TYPE) continue;
			const data = entry.data;
			if (typeof data !== "object" || data === null ||
				!("sessionId" in data) || !("enabled" in data) || typeof data.enabled !== "boolean") continue;
			branchMode = data.enabled;
			if (data.sessionId === sessionId) restored = data.enabled;
		}
		const inheritFork = reason === "fork";
		const inheritSubagent = isSubagent && (reason === "startup" || reason === "reload");
		if (restored === undefined && (inheritFork || inheritSubagent)) {
			restored = inheritFork ? branchMode ?? enabled : inheritedMode;
			pi.appendEntry(DISCUSS_MODE_STATE_TYPE, { sessionId, enabled: restored });
		}
		enabled = restored ?? false;
		updateStatus(ctx);
	}

	function sendModeNotice(): void {
		pi.sendMessage({
			customType: DISCUSS_MODE_STATE_TYPE,
			content: DISCUSS_MODE_CHANGED_MESSAGE,
			display: true,
		}, { deliverAs: "nextTurn" });
	}

	pi.on("session_start", (event, ctx) => {
		restoreMode(ctx, event.reason);
		if (enabled) sendModeNotice();
	});
	pi.on("session_tree", (_event, ctx) => {
		const wasEnabled = enabled;
		restoreMode(ctx, "tree");
		if (enabled !== wasEnabled) sendModeNotice();
	});
	pi.on("before_agent_start", (event) => {
		// Clear sections recorded by older versions when resuming a session.
		delete event.systemPromptOptions.sections.discuss_mode;
	});

	function set(on: boolean, ctx: ExtensionContext): string {
		restoreMode(ctx, "startup");
		if (on === enabled) return `Discuss mode is already ${on ? "on" : "off"}.`;
		enabled = on;
		pi.appendEntry(DISCUSS_MODE_STATE_TYPE, { sessionId: ctx.sessionManager.getSessionId(), enabled });
		ctx.ui.notify(enabled
			? "Discuss mode enabled. Edit and write tool calls are blocked."
			: "Discuss mode disabled. Edit and write tool calls are permitted.");
		sendModeNotice();
		updateStatus(ctx);
		return status(ctx);
	}

	pi.registerCommand("discuss", {
		description: "Toggle discuss mode (exploration and analysis)",
		handler: async (_args, ctx) => { restoreMode(ctx, "startup"); set(!enabled, ctx); },
	});

	pi.registerTool({
		name: "discuss_mode_status",
		label: "Discuss Mode Status",
		description: "Get the current session's discuss-mode status without changing it.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return {
				content: [{ type: "text", text: status(ctx) }],
				details: { enabled },
			};
		},
	});

	pi.events.on(BIND_CHANNEL, (data) => {
		const binding = data as { handlers?: { status(ctx: ExtensionContext): string; set(on: boolean, ctx: ExtensionContext): string }[] };
		binding.handlers?.push({ status, set });
	});

	pi.on("tool_call", (event, ctx) => {
		restoreMode(ctx, "startup");
		if (!enabled || event.toolName !== "edit" && event.toolName !== "write") return;
		return { block: true, reason: `Discuss mode: ${event.toolName} tool calls are disabled.` };
	});
}
