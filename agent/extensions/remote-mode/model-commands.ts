import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<string> {
	const parts = input.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) {
		return `Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}\nThinking: ${pi.getThinkingLevel()}`;
	}
	if (parts.length === 1 && parts[0] === "help") return HELP;

	if (parts.length === 1 && parts[0] === "list") {
		const groups = new Map<string, string[]>();
		for (const model of ctx.modelRegistry.getAll()) {
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
		const provider = parts.length === 4 ? parts[2] : ctx.model?.provider;
		const id = parts.at(-1)!;
		if (!provider) return "No current provider; use !model set model <provider> <model>.";
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) return `Model not found: ${provider}/${id}. Use !model list to see catalog models.`;
		try {
			if (!(await pi.setModel(model))) return `Authentication is not configured for ${provider}/${id}.`;
		} catch (error) {
			return `Could not set model ${provider}/${id}: ${error instanceof Error ? error.message : String(error)}`;
		}
		return `Model set to ${provider}/${id}. Thinking: ${pi.getThinkingLevel()}`;
	}

	if (parts[0] === "set" && parts[1] === "effort" && parts.length === 3) {
		const level = parts[2];
		if (!EFFORTS.includes(level as Effort)) return `Invalid effort: ${level}. Use ${EFFORTS.join("|")}.`;
		pi.setThinkingLevel(level as Effort);
		return `Thinking: ${pi.getThinkingLevel()}`;
	}

	return `Usage:\n${HELP}`;
}
