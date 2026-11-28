import assert from "node:assert/strict";
import { test } from "node:test";
import { fileReplies } from "./diff-replies.ts";

test("groups separate command fences for one file", () => {
	const blocks = [{command: "staged", output: "A\n"}, {command: "unstaged", output: "B\n"}];
	assert.deepEqual(fileReplies({ path: "x", statusLine: "MM x", blocks }), ["```\n$ # MM x\n$ staged\nA\n```\n\n```\n$ # MM x\n$ unstaged\nB\n```"]);
});

test("numbers bounded, independently fenced parts and preserves long lines", () => {
	const output = "😀```abc".repeat(300);
	const parts = fileReplies({path: "x", statusLine: " M x", blocks: [{command: "git diff -- x", output}]}, 170);
	assert.ok(parts.length > 1);
	let recovered = "";
	for (const [i, part] of parts.entries()) {
		assert.ok(part.isWellFormed() && part.length <= 170);
		const [heading, fence, status, command, body, end] = part.split("\n");
		assert.equal(heading, `"x" (${i + 1}/${parts.length})`);
		assert.equal(status, "$ #  M x");
		assert.equal(command, "$ git diff -- x");
		assert.equal(end, fence);
		assert.ok(!body.includes(fence));
		recovered += body;
	}
	assert.equal(recovered, output);
});
