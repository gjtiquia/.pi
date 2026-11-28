import assert from "node:assert/strict";
import { test } from "node:test";
import { sendAgentPrompt, stopAgent } from "./agent-commands.ts";

function createHost(idle = false, pending = false) {
	const sent: Array<{ prompt: string; options?: { deliverAs?: "steer" | "followUp" } }> = [];
	const host = {
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		aborts: 0,
		abort: () => { host.aborts++; },
		sendUserMessage: (prompt: string, options?: { deliverAs?: "steer" | "followUp" }) => {
			sent.push({ prompt, options });
		},
		sent,
	};
	return host;
}

function runPrompt(command: "queue" | "steer", payload: string, idle = false) {
	const host = createHost(idle);
	const response = sendAgentPrompt(command, payload, host);
	return { response, sent: host.sent };
}

test("stop cancels work and queued messages, even when idle", () => {
	const busy = createHost();
	assert.match(stopAgent(busy), /Stopped current work/);
	assert.equal(busy.aborts, 1);

	const pending = createHost(true, true);
	assert.match(stopAgent(pending), /cleared queued messages/);
	assert.equal(pending.aborts, 1);

	const idle = createHost(true);
	assert.match(stopAgent(idle), /Nothing running or queued/);
	assert.equal(idle.aborts, 1);
});

test("queue and steer require a non-whitespace prompt", () => {
	for (const command of ["queue", "steer"] as const) {
		for (const payload of ["", "   \n "]) {
			const result = runPrompt(command, payload);
			assert.match(result.response ?? "", /Usage:/);
			assert.deepEqual(result.sent, []);
		}
	}
});

test("queue follows up, steer interrupts, and both send normally when idle", () => {
	assert.deepEqual(runPrompt("queue", "  do this\n  then that  ").sent, [
		{ prompt: "do this\n  then that", options: { deliverAs: "followUp" } },
	]);
	assert.deepEqual(runPrompt("steer", "focus here").sent, [
		{ prompt: "focus here", options: { deliverAs: "steer" } },
	]);
	assert.deepEqual(runPrompt("queue", "next", true).sent, [{ prompt: "next", options: undefined }]);
	assert.deepEqual(runPrompt("steer", "now", true).sent, [{ prompt: "now", options: undefined }]);
	assert.equal(runPrompt("queue", "next").response, "Prompt queued.");
	assert.equal(runPrompt("steer", "now").response, undefined);
});
