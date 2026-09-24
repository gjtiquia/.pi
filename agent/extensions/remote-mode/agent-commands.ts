export const STOP_USAGE = ["!stop / !abort — abort current work and clear queued messages"];
export const QUEUE_USAGE = ["!queue <prompt> — send after current work finishes"];
export const STEER_USAGE = ["!steer <prompt> — steer current work as soon as possible"];

export function handleAgentCommand(
	input: string,
	controls: {
		isIdle: () => boolean;
		hasPendingMessages: () => boolean;
		abort: () => void;
		sendUserMessage: (prompt: string, options?: { deliverAs: "steer" | "followUp" }) => void;
	},
): { handled: boolean; response?: string } {
	const match = /^!(stop|abort|queue|steer)(?=\s|$)([\s\S]*)/.exec(input.trimStart());
	if (!match) return { handled: false };

	const [, command, rest] = match;
	if (command === "stop" || command === "abort") {
		if (rest.trim()) return { handled: true, response: `Usage: ${STOP_USAGE[0]}` };
		const hadWork = !controls.isIdle() || controls.hasPendingMessages();
		controls.abort();
		return { handled: true, response: hadWork ? "Stopped current work and cleared queued messages." : "Nothing running or queued." };
	}

	const prompt = rest.trim();
	if (!prompt) return { handled: true, response: `Usage: ${(command === "queue" ? QUEUE_USAGE : STEER_USAGE)[0]}` };
	const idle = controls.isIdle();
	if (idle) controls.sendUserMessage(prompt);
	else controls.sendUserMessage(prompt, { deliverAs: command === "queue" ? "followUp" : "steer" });
	return { handled: true, response: command === "queue" && !idle ? "Prompt queued." : undefined };
}
