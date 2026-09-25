import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSkillCommand } from "./skill-commands.ts";

const commands = [
	{ name: "skill:matt-tdd", description: "Test driven development", source: "skill" },
	{ name: "skill:matt-research", description: "Research primary sources", source: "skill" },
	{ name: "model", description: "Not a skill", source: "extension" },
];

function run(input: string) {
	const sent: string[] = [];
	const result = handleSkillCommand(input, commands, (message) => sent.push(message));
	return { ...result, sent };
}

test("bare and help requests display usage without invoking a skill", () => {
	for (const input of ["!skill", "!skill help", " !skill   "]) {
		const result = run(input);
		assert.equal(result.handled, true);
		assert.match(result.response ?? "", /!skill <skill-name> \[prompt\]/);
		assert.deepEqual(result.sent, []);
	}
});

test("list returns only loaded skill names, one per line", () => {
	assert.equal(run("!skill list").response, "matt-research\nmatt-tdd");
});

test("search and filter match all keywords against name and description case-insensitively", () => {
	assert.equal(run("!skill search TDD development").response, "matt-tdd");
	assert.equal(run("!skill filter PRIMARY research").response, "matt-research");
	assert.equal(run("!skill search missing").response, "No matching skills found.");
	assert.match(run("!skill filter").response ?? "", /Usage:/);
});

test("invokes the exact skill and preserves prompt whitespace", () => {
	const result = run("!skill matt-tdd  build this\n  then that");
	assert.deepEqual(result, { handled: true, sent: ["/skill:matt-tdd  build this\n  then that"] });
	assert.deepEqual(run("!skill matt-tdd").sent, ["/skill:matt-tdd"]);
});

test("unknown skill is handled, not forwarded to the model", () => {
	const result = run("!skill matt-tdd-typo fix it");
	assert.equal(result.handled, true);
	assert.match(result.response ?? "", /Unknown skill: matt-tdd-typo/);
	assert.deepEqual(result.sent, []);
	assert.equal(run("!skillful").handled, false);
});
