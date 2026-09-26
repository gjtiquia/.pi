import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchRemoteCommand } from "./command-router.ts";

test("optional session title preserves spaces and allows an unnamed session", async () => {
	const titles: string[] = [];
	const definitions = [{
		name: "new", usage: ["!new session [title]"],
		actions: { session: { args: "optional" as const, run: (title: string) => { titles.push(title); } } },
	}];
	await dispatchRemoteCommand("!new session", definitions);
	await dispatchRemoteCommand("!new session Fix remote title", definitions);
	assert.deepEqual(titles, ["", "Fix remote title"]);
});

test("free-form action preserves multiline prompts without treating prompt words as subcommands", async () => {
	const prompts: string[] = [];
	const definitions = [{
		name: "one-shot", usage: ["!one-shot <prompt>"], rawArgs: true,
		actions: { "": { args: "required" as const, run: (prompt: string) => { prompts.push(prompt); } } },
	}];
	assert.match((await dispatchRemoteCommand("!one-shot", definitions)).response ?? "", /Usage/);
	assert.match((await dispatchRemoteCommand("!one-shot  \n  ", definitions)).response ?? "", /Usage/);
	await dispatchRemoteCommand("!one-shot  Review this:\n  keep indentation  and spacing", definitions);
	await dispatchRemoteCommand("!one-shot remote done", definitions);
	assert.deepEqual(prompts, ["Review this:\n  keep indentation  and spacing", "remote done"]);
});

test("list and ls show the same complete catalog as help", async () => {
	const definitions = [
		{ name: "help", aliases: ["list", "ls"], usage: ["!help / !list / !ls"], actions: {} },
		{ name: "stop", aliases: ["abort"], usage: ["!stop / !abort"], actions: {} },
		{ name: "queue", usage: ["!queue <prompt>"], actions: {} },
	];
	const help = await dispatchRemoteCommand("!help", definitions);
	assert.match(help.response ?? "", /!help \/ !list \/ !ls/);
	assert.match(help.response ?? "", /!stop \/ !abort/);
	assert.match(help.response ?? "", /!queue <prompt>/);
	assert.deepEqual(await dispatchRemoteCommand("!list", definitions), help);
	assert.deepEqual(await dispatchRemoteCommand("!ls", definitions), help);
});
