import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DISCUSS_MODE_DISABLED_TOOLS = new Set(["edit", "write"]);
const DISCUSS_MODE_STATE_TYPE = "discuss-mode-state";

const DISCUSS_MODE_ACTIVE_MESSAGE = `[DISCUSS MODE ACTIVE]
You are in discuss mode for exploration and analysis.

Restrictions:
- The edit and write tools are disabled
- Other active tools remain available
- Do not use any available tool to make changes

Discuss, inspect, and analyze only.`;

const DISCUSS_MODE_DISABLED_MESSAGE = `[DISCUSS MODE DISABLED]
This supersedes earlier discuss-mode instructions.
The original tool set is restored. Normal coding mode is active.`;

export default function discussModeExtension(pi: ExtensionAPI): void {
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
				display: true,
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
		description: "Toggle discuss mode (exploration and analysis)",
		handler: (_args, ctx) => toggleDiscussMode(ctx),
	});
}
