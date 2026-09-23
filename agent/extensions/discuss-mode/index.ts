import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DISCUSS_MODE_STATE_TYPE = "discuss-mode-state";
const DISCUSS_MODE_ENV = "PI_DISCUSS_MODE";
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";

function isDiscussModeEnabled(): boolean {
	return process.env[DISCUSS_MODE_ENV] === "1";
}

const DISCUSS_MODE_ACTIVE_MESSAGE = `[DISCUSS MODE ACTIVE]
You are in discuss mode for exploration and analysis.

Restrictions:
- The edit and write tools are disabled
- Other active tools remain available
- Do not use any available tool to make changes

Discuss, inspect, and analyze only.`;

const DISCUSS_MODE_DISABLED_MESSAGE = `[DISCUSS MODE DISABLED]
This supersedes earlier discuss-mode instructions.
Edit and write tool calls are permitted again. Normal coding mode is active.`;

export default function discussModeExtension(pi: ExtensionAPI): void {
	const isSubagent = process.env[SUBAGENT_DEPTH_ENV] !== undefined;
	// Capture before clearing: a fork replaces the extension runtime, but must keep
	// the outgoing session's mode even when the fork point predates its toggle.
	const inheritedMode = isDiscussModeEnabled();
	// A root process must not inherit another session's mode through its environment.
	if (!isSubagent) delete process.env[DISCUSS_MODE_ENV];

	function restoreMode(ctx: ExtensionContext, reason: string): void {
		const sessionId = ctx.sessionManager.getSessionId();
		let enabled: boolean | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== DISCUSS_MODE_STATE_TYPE) continue;
			const data = entry.data;
			if (typeof data !== "object" || data === null ||
				!("sessionId" in data) || data.sessionId !== sessionId ||
				!("enabled" in data) || typeof data.enabled !== "boolean") continue;
			enabled = data.enabled;
		}
		// A fork copies only the branch up to its selected entry, with a new session
		// ID. Its inherited mode is the mode at fork time, not an old branch entry.
		// Subagents also need to record their inherited flag so a later resume can
		// restore it without depending on the process environment.
		const inheritFork = reason === "fork";
		const inheritSubagent = isSubagent && (reason === "startup" || reason === "reload");
		if (enabled === undefined && (inheritFork || inheritSubagent) && inheritedMode) {
			enabled = true;
			pi.appendEntry(DISCUSS_MODE_STATE_TYPE, { sessionId, enabled });
		}
		if (enabled) process.env[DISCUSS_MODE_ENV] = "1";
		else delete process.env[DISCUSS_MODE_ENV];
		updateStatus(ctx);
	}

	pi.on("session_start", (event, ctx) => restoreMode(ctx, event.reason));
	pi.on("session_tree", (_event, ctx) => restoreMode(ctx, "tree"));

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			"discuss-mode",
			isDiscussModeEnabled() ? ctx.ui.theme.fg("warning", "💬 discuss") : undefined,
		);
	}

	function announceModeState(): void {
		pi.sendMessage(
			{
				customType: DISCUSS_MODE_STATE_TYPE,
				content: isDiscussModeEnabled() ? DISCUSS_MODE_ACTIVE_MESSAGE : DISCUSS_MODE_DISABLED_MESSAGE,
				display: true,
			},
			{ deliverAs: "nextTurn" },
		);
	}

	function toggleDiscussMode(ctx: ExtensionContext): void {
		if (isDiscussModeEnabled()) delete process.env[DISCUSS_MODE_ENV];
		else process.env[DISCUSS_MODE_ENV] = "1";
		pi.appendEntry(DISCUSS_MODE_STATE_TYPE, {
			sessionId: ctx.sessionManager.getSessionId(),
			enabled: isDiscussModeEnabled(),
		});

		ctx.ui.notify(
			isDiscussModeEnabled()
				? "Discuss mode enabled. Edit and write tool calls are blocked."
				: "Discuss mode disabled. Edit and write tool calls are permitted.",
		);

		announceModeState();
		updateStatus(ctx);
	}

	pi.registerCommand("discuss", {
		description: "Toggle discuss mode (exploration and analysis)",
		handler: async (_args, ctx) => { toggleDiscussMode(ctx); },
	});

	pi.on("tool_call", (event) => {
		if (!isDiscussModeEnabled()) return;
		if (event.toolName !== "edit" && event.toolName !== "write") return;

		return {
			block: true,
			reason: `Discuss mode: ${event.toolName} tool calls are disabled.`,
		};
	});
}
