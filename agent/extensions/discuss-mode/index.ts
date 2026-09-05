import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isSafeCommand } from "./utils.ts";

const DISCUSS_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const DISCUSS_MODE_DISABLED_TOOLS = new Set(["edit", "write", "subagent", "bg_wait", "subagent_supervisor"]);

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
		pi.setActiveTools([
			...new Set([
				...toolsBeforeDiscussMode.filter((name) => !DISCUSS_MODE_DISABLED_TOOLS.has(name)),
				...DISCUSS_MODE_TOOLS,
			]),
		]);
	}

	function restoreNormalTools(): void {
		if (toolsBeforeDiscussMode) {
			pi.setActiveTools(toolsBeforeDiscussMode);
		}
		toolsBeforeDiscussMode = undefined;
	}

	function toggleDiscussMode(ctx: ExtensionContext): void {
		discussModeEnabled = !discussModeEnabled;

		if (discussModeEnabled) {
			enableDiscussModeTools();
			ctx.ui.notify("Discuss mode enabled. Write and subagent tools disabled.");
		} else {
			restoreNormalTools();
			ctx.ui.notify("Discuss mode disabled. Normal tool access restored.");
		}

		updateStatus(ctx);
	}

	pi.registerCommand("discuss", {
		description: "Toggle discuss mode (read-only exploration)",
		handler: async (_args, ctx) => toggleDiscussMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!discussModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Discuss mode: command blocked (not allowlisted). Use /discuss to disable discuss mode first.\nCommand: ${command}`,
			};
		}
	});

	pi.on("before_agent_start", async () => {
		if (!discussModeEnabled) return;

		return {
			message: {
				customType: "discuss-mode-context",
				content: `[DISCUSS MODE ACTIVE]
You are in discuss mode - a read-only exploration mode.

Restrictions:
- Built-in edit and write tools are disabled
- Subagent tools are disabled
- Bash is restricted to an allowlist of read-only commands

Do not make changes. Discuss, inspect, and analyze only.`,
				display: false,
			},
		};
	});
}
