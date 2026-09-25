import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleShellCommand } from "./shell-commands.ts";

test("both aliases preserve shell syntax and execute in Pi's cwd", async () => {
	const dir = await mkdtemp(join(tmpdir(), "remote-shell-"));
	try {
		assert.match(await handleShellCommand("!$", dir), /Usage:/);
		assert.match(await handleShellCommand("!shell", dir), /Usage:/);
		await assert.rejects(handleShellCommand("!shellfish echo nope", dir), /Not a remote shell command/);
		const command = `printf '%s' "a b" | tr ' ' '_' ; pwd`;
		const result = await handleShellCommand(`!$ ${command}`, dir);
		assert.match(result, /a_b/);
		assert.match(result, new RegExp(dir));
		assert.match(result, /exit 0/);
		assert.match(await handleShellCommand("!shell exit 7", dir), /exit 7/);
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
		const result = await handleShellCommand("!shell printf '%s' \"$REMOTE_SHELL_TEST\"", dir, true);
		assert.match(result, /from-prefix/);
		assert.match(result, /exit 0/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
