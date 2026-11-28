import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runShell } from "./shell-commands.ts";

test("preserves shell syntax and executes in Pi's cwd", async () => {
	const dir = await mkdtemp(join(tmpdir(), "remote-shell-"));
	try {
		assert.match(await runShell("", dir), /Usage:/);
		assert.match(await runShell("help", dir), /Usage:/);
		const command = `printf '%s' "a b" | tr ' ' '_' ; pwd`;
		const result = await runShell(command, dir);
		assert.match(result, /a_b/);
		assert.match(result, new RegExp(dir));
		assert.match(result, /exit 0/);
		assert.equal(await runShell("exit 7", dir), "```\n$ exit 7\n(exit 7)\n```");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("supports configured shell and command prefix", async () => {
	const dir = await mkdtemp(join(tmpdir(), "remote-shell-settings-"));
	try {
		// Project settings are loaded only for a trusted project.
		await mkdir(join(dir, ".pi"));
		await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({ shellPath: "/bin/sh", shellCommandPrefix: "export REMOTE_SHELL_TEST=from-prefix" }));
		const result = await runShell("printf '%s' \"$REMOTE_SHELL_TEST\"", dir, true);
		assert.match(result, /from-prefix/);
		assert.match(result, /exit 0/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
