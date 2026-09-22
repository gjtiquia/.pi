import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import notifier from "node-notifier";

function sendNativeNotification(title: string, message: string): Promise<void> {
	return new Promise((resolve, reject) => {
		notifier.notify({ title, message, timeout: false }, (error: Error | null) => {
			if (error) {
				reject(new Error(`Native notification failed: ${error.message}`));
			} else {
				resolve();
			}
		});
	});
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_DEPTH) return;

	pi.on("agent_settled", async (_event, ctx) => {
		let message = basename(ctx.cwd) || ctx.cwd;

		if (process.env.TMUX) {
			const args = ["display-message", "-p"];
			if (process.env.TMUX_PANE) args.push("-t", process.env.TMUX_PANE);
			args.push("#S: #I");

			try {
				const result = await pi.exec("tmux", args, { timeout: 2000 });
				if (result.code === 0 && result.stdout.trim()) {
					message = result.stdout.trim();
				}
			} catch {
				// Fall back to the project directory when tmux metadata is unavailable.
			}
		}

		try {
			await sendNativeNotification("Pi - agent_settled", message);
		} catch {
			// Native notifications are optional; ignore unavailable or failed backends.
		}
	});
}
