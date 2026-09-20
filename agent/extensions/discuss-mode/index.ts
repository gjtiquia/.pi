import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DISCUSS_MODE_DISABLED_TOOLS = new Set(["edit", "write"]);
const DISCUSS_MODE_STATE_TYPE = "discuss-mode-state";

const DISCUSS_MODE_ACTIVE_MESSAGE = `[DISCUSS MODE ACTIVE]
You are in discuss mode - a read-only exploration mode.

Restrictions:
- Built-in edit and write tools are disabled
- Bash and subagents remain available for exploration
- Bash is not sandboxed; do not use it to make changes

Do not make changes. Discuss, inspect, and analyze only.`;

const DISCUSS_MODE_DISABLED_MESSAGE = `[DISCUSS MODE DISABLED]
This supersedes all earlier discuss-mode instructions.
Normal coding mode is active. Editing, writing, and subagent use are permitted.`;

export default function discussModeExtension(pi: ExtensionAPI): void {
	const instanceGeneration = randomUUID();
	let discussModeEnabled = false;
	let toolsBeforeDiscussMode: string[] | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			"discuss-mode",
			discussModeEnabled ? ctx.ui.theme.fg("warning", "💬 discuss") : undefined,
		);
	}

	function enableDiscussModeTools(): void {
		toolsBeforeDiscussMode = pi.getActiveTools();
		pi.setActiveTools(
			toolsBeforeDiscussMode.filter((name) => !DISCUSS_MODE_DISABLED_TOOLS.has(name)),
		);
	}

	function restoreNormalTools(): void {
		if (toolsBeforeDiscussMode) {
			pi.setActiveTools(toolsBeforeDiscussMode);
		}
		toolsBeforeDiscussMode = undefined;
	}

	function announceModeState(): void {
		pi.sendMessage(
			{
				customType: DISCUSS_MODE_STATE_TYPE,
				content: discussModeEnabled ? DISCUSS_MODE_ACTIVE_MESSAGE : DISCUSS_MODE_DISABLED_MESSAGE,
				display: false,
				details: { generation: instanceGeneration },
			},
			{ deliverAs: "nextTurn" },
		);
	}

	function toggleDiscussMode(ctx: ExtensionContext): void {
		discussModeEnabled = !discussModeEnabled;

		if (discussModeEnabled) {
			enableDiscussModeTools();
			ctx.ui.notify("Discuss mode enabled. Built-in edit and write tools disabled.");
		} else {
			restoreNormalTools();
			ctx.ui.notify("Discuss mode disabled. Normal tool access restored.");
		}

		announceModeState();
		updateStatus(ctx);
	}

	pi.registerCommand("discuss", {
		description: "Toggle discuss mode (read-only exploration)",
		handler: async (_args, ctx) => toggleDiscussMode(ctx),
	});

	// Keep state markers scoped to this extension instance. Mode enforcement
	// resets to disabled on reload/resume, so markers from older instances would
	// otherwise contradict the current tool state.
	pi.on("context", async (event) => ({
		messages: event.messages.filter((message) => {
			if (message.role !== "custom") return true;
			if (message.customType !== DISCUSS_MODE_STATE_TYPE) return true;

			const details = message.details;
			return (
				typeof details === "object" &&
				details !== null &&
				"generation" in details &&
				details.generation === instanceGeneration
			);
		}),
	}));
}
