import assert from "node:assert/strict";
import { test } from "node:test";
import { launchRemoteTmuxWindow, type TmuxRunner } from "./tmux-windows.ts";

function mockTmux() {
	const calls: string[][] = [];
	const run: TmuxRunner = async (args) => {
		calls.push([...args]);
		if (args[0] === "display-message") return "%1\t$2\t@3\n";
		if (args[0] === "new-window") return "@4\t%5\n";
		return "";
	};
	return { calls, run };
}

const env = { TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%1", SHELL: "/bin/bash" };

test("new remote window retains the unnamed startup command", async () => {
	const { calls, run } = mockTmux();
	assert.deepEqual(await launchRemoteTmuxWindow("/work", undefined, { run, env }), {
		status: "created", sessionId: "$2", windowId: "@4", paneId: "%5",
	});
	assert.deepEqual(calls[2], ["send-keys", "-t", "%5", "-l", "--", "pi '/remote on' '/remote ping'"]);
	assert.deepEqual(calls[3], ["send-keys", "-t", "%5", "Enter"]);
});

test("new remote window passes a shell-quoted session title to Pi", async () => {
	const { calls, run } = mockTmux();
	await launchRemoteTmuxWindow("/work", "O'Brien; $(touch /tmp/nope)", { run, env });
	assert.deepEqual(calls[2], [
		"send-keys", "-t", "%5", "-l", "--",
		"pi --name 'O'\\''Brien; $(touch /tmp/nope)' '/remote on' '/remote ping'",
	]);
});

test("new remote window does nothing outside tmux, even with a title", async () => {
	const { calls, run } = mockTmux();
	assert.deepEqual(await launchRemoteTmuxWindow("/work", "Named", { run, env: {} }), { status: "not-tmux" });
	assert.deepEqual(calls, []);
});
