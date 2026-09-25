import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleGitCommand, parseGitArgs } from "./git-commands.ts";

test("parses Git arguments without running a shell", () => {
	assert.deepEqual(parseGitArgs('commit -m "a message with spaces" -- "a file"'), [
		"commit", "-m", "a message with spaces", "--", "a file",
	]);
	assert.deepEqual(parseGitArgs("show 'HEAD:some file' '' a\\ b"), ["show", "HEAD:some file", "", "a b"]);
	assert.deepEqual(parseGitArgs("status; echo nope"), ["status;", "echo", "nope"]);
	assert.throws(() => parseGitArgs('commit -m "unclosed'), /Unclosed quote/);
});

test("bare command displays usage and Git runs in the supplied directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "remote-git-"));
	try {
		assert.match(await handleGitCommand("!git", dir), /Usage:/);
		const result = await handleGitCommand("!git init -q", dir);
		assert.match(result, /git init -q \(exit 0\)/);
		assert.match(await handleGitCommand("!git rev-parse --is-inside-work-tree", dir), /true/);
		assert.match(await handleGitCommand("!git not-a-command", dir), /exit 1/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("quoted arguments reach Git intact and no shell command is executed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "remote-git-"));
	try {
		const result = await handleGitCommand('!git -c "alias.say=!printf hello" say', dir);
		assert.match(result, /hello/);
		assert.match(result, /exit 0/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
