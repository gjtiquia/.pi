import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setStatus("session-id", ctx.ui.theme.fg("dim", `Session: ${ctx.sessionManager.getSessionId()}`));
	});
}
