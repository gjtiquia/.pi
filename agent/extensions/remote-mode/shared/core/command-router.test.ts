import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchRemoteCommand } from "./command-router.ts";

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
