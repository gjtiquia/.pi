export const SKILL_USAGE = [
	"!skill / !skill help — usage",
	"!skill list — available skills",
	"!skill search <keywords> / !skill filter <keywords> — find skills",
	"!skill <skill-name> [prompt] — invoke a skill",
];

interface SkillCommand {
	name: string;
	description?: string;
	source: string;
}

function usage(): string {
	return ["Usage:", ...SKILL_USAGE].join("\n");
}

function formatSkills(skills: SkillCommand[]): string {
	if (skills.length === 0) return "No matching skills found.";
	return skills.map((skill) => skill.name).join("\n");
}

export function runSkill(
	payload: string,
	commands: SkillCommand[],
	send: (message: string) => void,
): string | void {
	const input = payload.trimStart();
	const name = /^\S+/.exec(input)?.[0];
	if (!name || name === "help") return usage();

	const rest = input.slice(name.length);

	const skills = commands.filter((command) => command.source === "skill")
		.map((command) => ({ ...command, name: command.name.replace(/^skill:/, "") }))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (name === "list") return rest.trim() ? usage() : formatSkills(skills);
	if (name === "search" || name === "filter") {
		const keywords = rest.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!keywords.length) return usage();
		return formatSkills(skills.filter((skill) => {
			const text = `${skill.name} ${skill.description ?? ""}`.toLowerCase();
			return keywords.every((keyword) => text.includes(keyword));
		}));
	}

	const skill = skills.find((candidate) => candidate.name === name);
	if (!skill) return `Unknown skill: ${name}. Use !skill search <keywords> or !skill list.`;
	const prompt = rest.replace(/^\s/, "");
	send(`/skill:${skill.name}${prompt.trim() ? ` ${prompt}` : ""}`);
}
