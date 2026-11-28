import assert from "node:assert/strict";
import { test } from "node:test";
import { runSkill } from "./skill-commands.ts";

const commands = [
	{ name: "skill:matt-tdd", description: "Test driven development", source: "skill" },
	{ name: "skill:matt-research", description: "Research primary sources", source: "skill" },
	{ name: "model", description: "Not a skill", source: "extension" },
];

function run(payload: string) {
	const sent: string[] = [];
	const response = runSkill(payload, commands, (message) => sent.push(message));
	return { response, sent };
}

test("bare and help requests display usage without invoking a skill", () => {
	for (const payload of ["", "help", "   "]) {
		const result = run(payload);
		assert.match(result.response ?? "", /!skill <skill-name> \[prompt\]/);
		assert.deepEqual(result.sent, []);
	}
});

test("list returns only loaded skill names, one per line", () => {
	assert.equal(run("list").response, "matt-research\nmatt-tdd");
});

test("search and filter match all keywords against name and description case-insensitively", () => {
	assert.equal(run("search TDD development").response, "matt-tdd");
	assert.equal(run("filter PRIMARY research").response, "matt-research");
	assert.equal(run("search missing").response, "No matching skills found.");
	assert.match(run("filter").response ?? "", /Usage:/);
});

test("invokes the exact skill and preserves prompt whitespace", () => {
	const result = run("matt-tdd  build this\n  then that  ");
	assert.deepEqual(result, { response: undefined, sent: ["/skill:matt-tdd  build this\n  then that  "] });
	assert.deepEqual(run("matt-tdd").sent, ["/skill:matt-tdd"]);
});

test("unknown skill returns a message instead of invoking a skill", () => {
	const result = run("matt-tdd-typo fix it");
	assert.match(result.response ?? "", /Unknown skill: matt-tdd-typo/);
	assert.deepEqual(result.sent, []);
});
