export interface CommandDefinition {
	name: string;
	aliases?: string[];
	usage: string[];
	status?: () => string | Promise<string>;
	actions: Record<string, {
		args: "none" | "required" | "optional";
		run: (args: string) => string | void | Promise<string | void>;
	}>;
}

export async function dispatchRemoteCommand(
	input: string,
	definitions: CommandDefinition[],
): Promise<{ handled: boolean; response?: string }> {
	const parts = input.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0 || !parts[0].startsWith("!")) return { handled: false };

	const commandName = parts[0].slice(1);
	if (commandName === "help" || commandName === "list" || commandName === "ls") {
		const sections = await Promise.all(definitions.map(async (definition) => {
			const status = await definition.status?.();
			return [definition.name, ...definition.usage.map((line) => `  ${line}`), ...(status ? [`  ${status}`] : [])].join("\n");
		}));
		return { handled: true, response: sections.join("\n\n") };
	}

	const definition = definitions.find(
		(candidate) => candidate.name.replace(/^!/, "") === commandName
			|| candidate.aliases?.some((alias) => alias.replace(/^!/, "") === commandName),
	);
	if (!definition) return { handled: false };

	const usageAndStatus = async (): Promise<{ handled: true; response: string }> => {
		const status = await definition.status?.();
		return {
			handled: true,
			response: ["Usage:", ...definition.usage, ...(status ? [status] : [])].join("\n"),
		};
	};

	const args = parts.slice(1);
	if (args.length === 0 || (args.length === 1 && args[0] === "help")) return usageAndStatus();

	const action = Object.keys(definition.actions)
		.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length)
		.find((key) => {
			const actionParts = key.split(/\s+/).filter(Boolean);
			return actionParts.length <= args.length && actionParts.every((part, index) => part === args[index]);
		});
	if (!action) return usageAndStatus();

	const actionLength = action.split(/\s+/).filter(Boolean).length;
	const actionArgs = args.slice(actionLength).join(" ");
	const operation = definition.actions[action];
	if ((operation.args === "none" && actionArgs) || (operation.args === "required" && !actionArgs)) {
		return usageAndStatus();
	}
	const response = await operation.run(actionArgs);
	return response === undefined ? { handled: true } : { handled: true, response };
}
