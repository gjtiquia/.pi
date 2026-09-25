import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAgentCommand } from "./agent-commands.ts";

function run(input: string, idle = false, pending = false) {
	const sent: Array<{ prompt: string; options?: { deliverAs: "steer" | "followUp" } }> = [];
	let aborts = 0;
	const result = handleAgentCommand(input, {
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		abort: () => { aborts++; },
		sendUserMessage: (prompt, options) => sent.push({ prompt, options }),
	});
	return { ...result, sent, aborts };
}

test("stop and abort cancel work and queued messages, including when idle", () => {
	for (const command of ["!stop", "!abort", " !stop  "]) {
		assert.match(run(command).response ?? "", /Stopped current work/);
		assert.equal(run(command).aborts, 1);
	}
	assert.match(run("!abort", true, true).response ?? "", /cleared queued messages/);
	assert.match(run("!stop", true).response ?? "", /Nothing running or queued/);
	assert.equal(run("!stop now").aborts, 0);
});

test("queue and steer require a non-whitespace prompt", () => {
	for (const input of ["!queue", "!queue   \n ", "!steer", "!steer  "]) {
		const result = run(input);
		assert.match(result.response ?? "", /Usage:/);
		assert.deepEqual(result.sent, []);
	}
});

test("queue follows up, steer interrupts, and both send normally when idle", () => {
	assert.deepEqual(run("!queue  do this\n  then that").sent, [
		{ prompt: "do this\n  then that", options: { deliverAs: "followUp" } },
	]);
	assert.deepEqual(run("!steer focus here").sent, [
		{ prompt: "focus here", options: { deliverAs: "steer" } },
	]);
	assert.deepEqual(run("!queue next", true).sent, [{ prompt: "next", options: undefined }]);
	assert.deepEqual(run("!steer now", true).sent, [{ prompt: "now", options: undefined }]);
	assert.equal(run("!queue next").response, "Prompt queued.");
	assert.equal(run("!steering elsewhere").handled, false);
});
