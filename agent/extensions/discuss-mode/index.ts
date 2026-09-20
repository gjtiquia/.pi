import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DISCUSS_MODE_STATE_TYPE = "discuss-mode-state";
const DISCUSS_MODE_ENV = "PI_DISCUSS_MODE";
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";

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
	let discussModeEnabled = false;

	// A root extension reload disables discuss mode. Subagents retain the flag so
	// their descendants inherit the same write-tool restriction.
	if (process.env[SUBAGENT_DEPTH_ENV] === undefined) {
		delete process.env[DISCUSS_MODE_ENV];
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			"discuss-mode",
			discussModeEnabled ? ctx.ui.theme.fg("warning", "💬 discuss") : undefined,
		);
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
		if (discussModeEnabled) process.env[DISCUSS_MODE_ENV] = "1";
		else delete process.env[DISCUSS_MODE_ENV];

		ctx.ui.notify(
			discussModeEnabled
				? "Discuss mode enabled. Edit and write tool calls are blocked."
				: "Discuss mode disabled. Edit and write tool calls are permitted.",
		);

		announceModeState();
		updateStatus(ctx);
	}

	pi.registerCommand("discuss", {
		description: "Toggle discuss mode (exploration and analysis)",
		handler: (_args, ctx) => toggleDiscussMode(ctx),
	});

	pi.on("tool_call", (event) => {
		if (!discussModeEnabled) return;
		if (event.toolName !== "edit" && event.toolName !== "write") return;

		return {
			block: true,
			reason: `Discuss mode: ${event.toolName} tool calls are disabled.`,
		};
	});
}
