import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import notifier from "node-notifier";

function sendNativeNotification(title: string, message: string): Promise<void> {
	return new Promise((resolve, reject) => {
		notifier.notify({ title, message }, (error: Error | null) => {
			if (error) {
				reject(new Error(`Native notification failed: ${error.message}`));
			} else {
				resolve();
			}
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_settled", async () => {
		await sendNativeNotification("Pi", "Ready for input");
	});
}
