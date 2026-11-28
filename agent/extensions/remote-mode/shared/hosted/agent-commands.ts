import type { CommandHost } from "../host.js";

export const STOP_USAGE = ["!stop / !abort — abort current work and clear queued messages"];
export const QUEUE_USAGE = ["!queue <prompt> — send after current work finishes"];
export const STEER_USAGE = ["!steer <prompt> — steer current work as soon as possible"];

export function stopAgent(host: Pick<CommandHost, "isIdle" | "hasPendingMessages" | "abort">): string {
	const hadWork = !host.isIdle() || host.hasPendingMessages();
	host.abort();
	return hadWork ? "Stopped current work and cleared queued messages." : "Nothing running or queued.";
}

export function sendAgentPrompt(
	command: "queue" | "steer",
	payload: string,
	host: Pick<CommandHost, "isIdle" | "sendUserMessage">,
): string | void {
	const prompt = payload.trim();
	if (!prompt) return `Usage: ${(command === "queue" ? QUEUE_USAGE : STEER_USAGE)[0]}`;
	const idle = host.isIdle();
	if (idle) host.sendUserMessage(prompt);
	else host.sendUserMessage(prompt, { deliverAs: command === "queue" ? "followUp" : "steer" });
	if (command === "queue" && !idle) return "Prompt queued.";
}
