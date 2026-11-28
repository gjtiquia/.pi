import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { diffFiles } from "./diff-files.ts";

function git(cwd: string, ...args: string[]) {
	execFileSync("git", ["--literal-pathspecs", ...args], { cwd });
}

async function repo(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "remote-diff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	git(root, "init", "-q");
	git(root, "config", "user.name", "Test User");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "commit.gpgsign", "false");
	return root;
}

function commit(root: string) {
	git(root, "add", "--all");
	git(root, "commit", "-qm", "initial contents");
}

test("groups staged and unstaged patches for a path and collects untracked files in an unborn repo", async (t) => {
	const root = await repo(t);
	await writeFile(join(root, "both.txt"), "staged content\n");
	git(root, "add", "--", "both.txt");
	await writeFile(join(root, "both.txt"), "unstaged content\n");
	await writeFile(join(root, "-"), "untracked content\n");
	await writeFile(join(root, "ignored.txt"), "should not appear\n");
	await writeFile(join(root, ".git", "info", "exclude"), "ignored.txt\n");

	// This setting distinguishes the literal command from a hidden --no-color invocation.
	git(root, "config", "color.diff", "always");
	const files = new Map((await Array.fromAsync(diffFiles(root))).map((file) => [file.path, file.blocks]));
	assert.equal(files.size, 2);
	const blocks = files.get("both.txt");
	assert.ok(blocks);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].command, "git --no-pager diff --cached -- both.txt");
	assert.equal(blocks[1].command, "git --no-pager diff -- both.txt");
	assert.match(blocks[0].output, /staged content/);
	assert.doesNotMatch(blocks[0].output, /unstaged content/);
	for (const block of blocks) assert.equal(block.output, execFileSync("sh", ["-c", block.command], { cwd: root, encoding: "utf8" }));
	const untracked = files.get("-");
	assert.ok(untracked);
	assert.equal(untracked.length, 1);
	assert.equal(untracked[0].command, "git --no-pager diff --no-index -- /dev/null ./-");
	assert.match(untracked[0].output, /untracked content/);
});

test("uses the rename destination as its path and retains the staged rename and unstaged edit", async (t) => {
	const root = await repo(t);
	const source = "old name.txt";
	const destination = "new name.txt";
	await writeFile(join(root, source), "original content\n");
	commit(root);
	git(root, "config", "status.renames", "true");
	git(root, "mv", "--", source, destination);
	await writeFile(join(root, destination), "updated content\n");

	const files = await Array.fromAsync(diffFiles(root));
	assert.deepEqual(files.map((file) => file.path), [destination]);
	const { blocks } = files[0];
	assert.equal(blocks.length, 2);
	assert.match(blocks[0].command, /-- 'old name\.txt' 'new name\.txt'$/);
	assert.match(blocks[0].output, /rename from old name\.txt\nrename to new name\.txt/);
	assert.match(blocks[1].output, /-original content\n\+updated content/);

	git(root, "config", "status.renames", "false");
	const withoutRenames = await Array.fromAsync(diffFiles(root));
	assert.deepEqual(withoutRenames.map((file) => file.path), [destination, source]);
	assert.match(withoutRenames[0].blocks[0].output, /new file mode/);
	assert.match(withoutRenames[1].blocks[0].output, /deleted file mode/);
});

test("discovers from the root and quotes literal Git paths with spaces, quotes, tabs and newlines", async (t) => {
	const root = await repo(t);
	const directory = join(root, "nested");
	const unusual = ":(glob)* 'tab\tline\n.txt";
	await mkdir(directory);
	await writeFile(join(root, unusual), "before\n");
	await writeFile(join(root, "other.txt"), "different before\n");
	commit(root);
	await writeFile(join(root, unusual), "literal path change\n");
	await writeFile(join(root, "other.txt"), "different after\n");
	await writeFile(join(directory, "untracked.txt"), "nested untracked\n");

	const files = await Array.fromAsync(diffFiles(directory));
	assert.deepEqual(new Set(files.map((file) => file.path)), new Set([unusual, "other.txt", "nested/untracked.txt"]));
	const literal = files.find((file) => file.path === unusual);
	assert.ok(literal);
	const [block] = literal.blocks;
	assert.match(block.command, /^git -C .* --no-pager --literal-pathspecs diff -- /);
	assert.ok(block.command.endsWith("-- ':(glob)* '\\''tab\tline\n.txt'"));
	assert.match(block.output, /\+literal path change/);
	assert.doesNotMatch(block.output, /different after/);
});

test("preserves porcelain status order and summarizes an untracked embedded repository", async (t) => {
	const root = await repo(t);
	await writeFile(join(root, "z-tracked.txt"), "before\n");
	commit(root);
	await writeFile(join(root, "z-tracked.txt"), "after\n");
	await mkdir(join(root, "a-directory"));
	await writeFile(join(root, "a-directory", "untracked.txt"), "ordinary untracked content\n");
	await mkdir(join(root, "embedded"));
	git(join(root, "embedded"), "init", "-q");
	await writeFile(join(root, "embedded", "private.txt"), "not in the parent diff\n");

	const files = await Array.fromAsync(diffFiles(root));
	assert.deepEqual(files.map((file) => file.path), ["z-tracked.txt", "a-directory/untracked.txt", "embedded/"]);
	assert.match(files[1].blocks[0].output, /\+ordinary untracked content/);
	const [summary] = files[2].blocks;
	assert.match(summary.command, /status -suall -- embedded\/$/);
	assert.equal(summary.output, execFileSync("sh", ["-c", summary.command], { cwd: root, encoding: "utf8" }));
	assert.doesNotMatch(summary.output, /private\.txt|not in the parent diff/);
});

test("uses a combined diff for conflicts instead of splitting them into staged and unstaged patches", async (t) => {
	const root = await repo(t);
	await writeFile(join(root, "conflict.txt"), "base\n");
	await writeFile(join(root, "modify-delete.txt"), "base\n");
	commit(root);
	git(root, "checkout", "-qb", "other");
	await writeFile(join(root, "conflict.txt"), "other side\n");
	await writeFile(join(root, "modify-delete.txt"), "other side\n");
	commit(root);
	git(root, "checkout", "-qb", "current", "HEAD^");
	await writeFile(join(root, "conflict.txt"), "current side\n");
	await rm(join(root, "modify-delete.txt"));
	commit(root);
	assert.throws(() => git(root, "merge", "--no-edit", "other"));

	const files = await Array.fromAsync(diffFiles(root));
	assert.deepEqual(files.map((file) => file.path), ["conflict.txt", "modify-delete.txt"]);
	assert.equal(files[0].blocks.length, 1);
	assert.match(files[0].blocks[0].command, /--cc -- conflict\.txt$/);
	assert.match(files[0].blocks[0].output, /diff --cc conflict\.txt/);
	assert.equal(files[1].blocks.length, 1);
	assert.match(files[1].blocks[0].command, /--cc -- modify-delete\.txt$/);
	const block = files[1].blocks[0];
	assert.equal(block.output, execFileSync("sh", ["-c", block.command], { cwd: root, encoding: "utf8" }));
});

test("yields no paths for a clean worktree and rejects an invalid cwd", async (t) => {
	const root = await repo(t);
	assert.deepEqual(await Array.fromAsync(diffFiles(root)), []);
	await assert.rejects(Array.fromAsync(diffFiles(join(root, "missing"))));
});
