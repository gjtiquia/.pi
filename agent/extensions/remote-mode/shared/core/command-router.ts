type Reply = string | void | AsyncIterable<string>;
type Run = (args: string) => Reply | Promise<Reply>;
export interface CommandResult { handled: boolean; response?: string; replies?: AsyncIterable<string> }

interface CommandInfo {
	name: string;
	aliases?: string[];
	sessionRequired?: boolean;
	usage: string[];
	status?: () => string | Promise<string>;
}

export type CommandDefinition = CommandInfo & ({
	/** Owns the entire payload (including literal "help" and trailing whitespace). */
	payload: Run;
	actions?: never;
	rawArgs?: never;
} | {
	payload?: never;
	rawArgs?: boolean;
	actions: Record<string, { args: "none" | "required" | "optional"; description?: string; run: Run }>;
});

export function matchCommand(input: string, definitions: CommandDefinition[]) {
	const trimmed = input.trimStart();
	const name = /^!(\S+)/.exec(trimmed)?.[1];
	if (!name) return;
	const definition = definitions.find(d => d.name === name || d.aliases?.includes(name));
	if (definition) return { definition, payload: trimmed.slice(name.length + 1).trimStart() };
}

function usage(def: CommandDefinition) {
	const generated = Object.entries(def.actions ?? {}).flatMap(([key, action]) =>
		action.description ? [`!${def.name}${key ? " " + key : ""} — ${action.description}`] : []);
	return [...def.usage, ...generated];
}

export function catalogHelp(definitions: CommandDefinition[]) {
	return Promise.all(definitions.map(async def => {
		const status = await def.status?.();
		return [def.name, ...usage(def).map(line => "  " + line), ...(status ? ["  " + status] : [])].join("\n");
	})).then(sections => sections.join("\n\n"));
}

async function execute(run: Run, args: string): Promise<CommandResult> {
	const reply = await run(args);
	if (typeof reply === "string") return { handled: true, response: reply };
	if (reply) return { handled: true, replies: reply };
	return { handled: true };
}

export async function dispatchRemoteCommand(input: string, definitions: CommandDefinition[]): Promise<CommandResult> {
	const match = matchCommand(input, definitions);
	if (!match) return { handled: false };
	const { definition, payload } = match;
	if (definition.payload) return execute(definition.payload, payload);
	const parts = payload.trim().split(/\s+/).filter(Boolean);
	if (!(parts.length === 1 && parts[0] === "help")) {
		for (const [key, action] of Object.entries(definition.actions).sort(([a], [b]) => b.length - a.length)) {
			const words = key ? key.split(/\s+/) : [];
			if (!words.every((word, i) => parts[i] === word)) continue;
			const args = definition.rawArgs && !key ? payload.trim() : parts.slice(words.length).join(" ");
			if ((action.args === "none" && args) || (action.args === "required" && !args)) break;
			return execute(action.run, args);
		}
	}
	const status = await definition.status?.();
	return { handled: true, response: ["Usage:", ...usage(definition), ...(status ? [status] : [])].join("\n") };
}
