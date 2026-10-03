import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityPostBuffer, splitActivityText } from "./post-buffer.js";
import { formatCommandActivity } from "./status-tracker.js";

// Apply plans as the remote transport does: patch the current post or create
// its successor. Earlier posts must never be removed or overwritten.
function apply(posts: string[], buffer: ActivityPostBuffer, text: string): void {
	for (const update of buffer.append(text)) {
		if (update.newPost) posts.push(update.message);
		else posts[posts.length - 1] = update.message;
	}
}

test("updates the current post, deduplicates, and rolls over without losing history", () => {
	const buffer = new ActivityPostBuffer(30);
	const posts: string[] = [];
	apply(posts, buffer, "[thinking…]");
	apply(posts, buffer, "[thinking…]");
	apply(posts, buffer, "[reading a file]");
	assert.deepEqual(posts, ["[thinking…]\n[reading a file]"]);
	apply(posts, buffer, "[completed]");
	assert.deepEqual(posts, ["[thinking…]\n[reading a file]", "[completed]"]);
});

test("retains every entry across a long run", () => {
	const buffer = new ActivityPostBuffer();
	const posts: string[] = [];
	const entries = Array.from({ length: 1_000 }, (_, i) => `[reading ${i}: ${"path/".repeat(20)}]`);
	for (const entry of entries) apply(posts, buffer, entry);
	assert.ok(posts.length > 1);
	assert.ok(posts.every((post) => post.length <= 14_000));
	assert.equal(posts.join("\n"), entries.join("\n"));
});

test("splits plain oversized entries losslessly, including newlines and Unicode", () => {
	for (const text of ["abcdef".repeat(8_000), "a\n\n".repeat(10_000), "😀".repeat(15_000)]) {
		const chunks = splitActivityText(text);
		assert.equal(chunks.join(""), text);
		assert.ok(chunks.every((chunk) => chunk.length <= 14_000));
		assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk)));
	}
});

test("splits commands into bounded, balanced code blocks without dropping command text", () => {
	for (const command of ["echo full command\n".repeat(3_000), "x".repeat(40_000), "echo '```'\n".repeat(3_000)]) {
		const text = formatCommandActivity("bash", command).text;
		const chunks = splitActivityText(text);
		assert.ok(chunks.length > 1);
		assert.ok(chunks.every((chunk) => chunk.length <= 14_000));
		const fence = command.includes("```") ? "````" : "```";
		const reconstructed = chunks.map((chunk) => {
			assert.ok(chunk.includes(`${fence}sh\n`));
			assert.ok(chunk.endsWith(fence));
			return chunk.slice(chunk.indexOf(`${fence}sh\n`) + fence.length + 3, -(fence.length + 1));
		}).join("");
		assert.equal(reconstructed, command);
	}
});

test("preserves activity before and after an oversized command", () => {
	const buffer = new ActivityPostBuffer();
	const posts: string[] = [];
	apply(posts, buffer, "[thinking…]");
	apply(posts, buffer, formatCommandActivity("powershell", "x".repeat(40_000)).text);
	apply(posts, buffer, "[completed]");
	assert.equal(posts[0], "[thinking…]");
	assert.ok(posts.at(-1)?.endsWith("[completed]"));
	assert.ok(posts.every((post) => post.length <= 14_000));
});

test("accounts for whitespace on closing fences", () => {
	const chunks = splitActivityText("```sh\n" + "x".repeat(13_988) + "\n```   \nfollowing");
	assert.ok(chunks.every((chunk) => chunk.length <= 14_000));
	assert.ok(chunks.join("").includes("```   \nfollowing"));
});

test("falls back to lossless literal splitting for pathological fences", () => {
	const text = formatCommandActivity("bash", "`".repeat(7_000)).text;
	const chunks = splitActivityText(text);
	assert.equal(chunks.join(""), text);
	assert.ok(chunks.every((chunk) => chunk.length <= 14_000));
});
