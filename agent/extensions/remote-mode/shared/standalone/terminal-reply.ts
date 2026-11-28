export function terminalReply(command: string, output: string, status: string, truncated: boolean): string {
	const body = [`$ ${command}`, output, truncated ? "[output truncated]" : "", `(${status})`].filter(Boolean).join("\n");
	let fence = "```";
	for (const run of body.match(/`{3,}/g) ?? []) {
		if (run.length >= fence.length) fence = "`".repeat(run.length + 1);
	}
	return `${fence}\n${body}\n${fence}`;
}
