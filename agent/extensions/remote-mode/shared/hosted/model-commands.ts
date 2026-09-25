import type { ModelHost } from "../host.js";

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const HELP = [
	"!model [status|help|list]",
	"!model set model <provider> <model>",
	"!model set model <model>  (current provider)",
	`!model set effort <${EFFORTS.join("|")}>`,
].join("\n");

/** Handle the text following !model; the caller is responsible for posting/splitting the response. */
export async function handleModelCommand(
	input: string,
	host: ModelHost,
): Promise<string> {
	const parts = input.trim().split(/\s+/).filter(Boolean);
	const model = host.current();
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) {
		return `Model: ${model ? `${model.provider}/${model.id}` : "none"}\nThinking: ${host.getEffort()}`;
	}
	if (parts.length === 1 && parts[0] === "help") return HELP;

	if (parts.length === 1 && parts[0] === "list") {
		const groups = new Map<string, string[]>();
		for (const model of host.list()) {
			const ids = groups.get(model.provider) ?? [];
			ids.push(model.id);
			groups.set(model.provider, ids);
		}
		if (groups.size === 0) return "No models in the catalog.";
		return [...groups.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([provider, ids]) => `${provider}:\n${ids.sort((a, b) => a.localeCompare(b)).map((id) => `  ${id}`).join("\n")}`)
			.join("\n\n");
	}

	if (parts[0] === "set" && parts[1] === "model" && (parts.length === 3 || parts.length === 4)) {
		const provider = parts.length === 4 ? parts[2] : model?.provider;
		const id = parts.at(-1)!;
		if (!provider) return "No current provider; use !model set model <provider> <model>.";
		const selected = host.list().find((model) => model.provider === provider && model.id === id);
		if (!selected) return `Model not found: ${provider}/${id}. Use !model list to see catalog models.`;
		try {
			if (!(await host.set(selected))) return `Authentication is not configured for ${provider}/${id}.`;
		} catch (error) {
			return `Could not set model ${provider}/${id}: ${error instanceof Error ? error.message : String(error)}`;
		}
		return `Model set to ${provider}/${id}. Thinking: ${host.getEffort()}`;
	}

	if (parts[0] === "set" && parts[1] === "effort" && parts.length === 3) {
		const level = parts[2];
		if (!EFFORTS.includes(level as Effort)) return `Invalid effort: ${level}. Use ${EFFORTS.join("|")}.`;
		host.setEffort(level as Effort);
		return `Thinking: ${host.getEffort()}`;
	}

	return `Usage:\n${HELP}`;
}
