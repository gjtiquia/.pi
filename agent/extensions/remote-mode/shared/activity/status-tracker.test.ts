import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityTracker, formatCommandActivity, formatSubagentActivity, renderActivityStatus } from "./status-tracker.js";

test("tracks generic activity and parallel tools until settlement", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	tracker.progress("responding", 2_000);
	tracker.startTool("a", "read", { path: "/tmp/a" }, 3_000);
	tracker.startTool("b", "custom_tool", {}, 4_000);
	tracker.endTool("a", false, 5_000);

	let snapshot = tracker.snapshot();
	assert.equal(snapshot.phase, "executing tools");
	assert.deepEqual(snapshot.activeTools.map((tool) => tool.id), ["b"]);
	assert.match(renderActivityStatus(snapshot, {
		idle: false,
		pendingMessages: true,
		now: 6_000,
	}), /State: RUNNING for 5s[\s\S]*Tool: custom tool \(2s\)[\s\S]*Queued prompts: yes/);

	tracker.setOutcome("aborted");
	tracker.settle(8_000);
	snapshot = tracker.snapshot();
	assert.match(renderActivityStatus(snapshot, {
		idle: true,
		pendingMessages: false,
		now: 10_000,
	}), /State: IDLE for 2s[\s\S]*Last run: aborted in 7s/);
});

test("preserves total run time across repeated low-level starts and degrades unknown busy work safely", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	tracker.start(5_000);
	assert.equal(tracker.snapshot().runStartedAt, 1_000);
	tracker.reset(8_000);
	assert.match(renderActivityStatus(tracker.snapshot(), {
		idle: false,
		pendingMessages: false,
		now: 10_000,
	}), /State: BUSY[\s\S]*background session operation/);
});

test("renders complete multiline bash commands in status and ordinary activity", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	const command = "printf '```'\necho the-complete-command-without-shortening";
	tracker.startTool("bash-1", "bash", { command }, 2_000);
	const output = renderActivityStatus(tracker.snapshot(), {
		idle: false,
		pendingMessages: false,
		now: 3_000,
	});
	assert.ok(output.includes(command));
	assert.match(output, /````sh\nprintf/);
	const activity = formatCommandActivity("bash", command);
	assert.ok(activity.text.includes(command));
	assert.match(activity.text, /^\[running bash\]\n````sh/);
});

test("preserves commands larger than a single Mattermost post", () => {
	const command = "echo full command\n".repeat(2_000);
	const activity = formatCommandActivity("bash", command);
	assert.ok(activity.text.includes(command));
	assert.doesNotMatch(activity.text, /omitted/);
});

test("does not shorten long file paths or search queries in status", () => {
	const tracker = new ActivityTracker(0);
	const path = "/long/path/".repeat(30);
	const query = "long query ".repeat(30);
	tracker.startTool("file", "read", { path }, 1);
	tracker.startTool("search", "web_search", { query }, 1);
	const output = renderActivityStatus(tracker.snapshot(), { idle: false, pendingMessages: false, now: 2 });
	assert.ok(output.includes(path));
	assert.ok(output.includes(query));
});

test("subagent preview waits for the confirmed child model without a provisional duplicate", () => {
	const summary = "Full unshortened summary ".repeat(20);
	const args = { summary, modelTier: "balanced", thinkingLevel: "high" };
	assert.equal(formatSubagentActivity(args), "");
	assert.equal(formatSubagentActivity(args, { details: { thinkingLevel: "high" } }), "");
	const result = { details: { modelProvider: "provider", modelId: "resolved-model", thinkingLevel: "medium", activity: "starting…" } };
	assert.equal(formatSubagentActivity(args, result), `waiting for subagent — ${summary} · model: provider/resolved-model · thinking: medium`);
	assert.equal(formatSubagentActivity(args, { details: { ...result.details, activity: "reading a file" } }), formatSubagentActivity(args, result));
	assert.equal(formatSubagentActivity({ model: "provider/explicit", thinkingLevel: "low" }), "");
	assert.doesNotThrow(() => formatSubagentActivity(undefined, { details: null }));
});

test("adds structured subagent diagnostics without making status subagent-specific", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	tracker.startTool("child", "subagent", { summary: "Review tests" }, 2_000);
	tracker.updateTool("child", {
		details: {
			summary: "Review tests",
			modelProvider: "openai-codex",
			modelId: "gpt-test",
			thinkingLevel: "high",
			activity: "running npm test",
			activityStartedAt: 3_000,
			lastEventAt: 8_000,
			stallTimeoutSeconds: 30,
			childSessionId: "child-id",
		},
	}, 9_000);
	const output = renderActivityStatus(tracker.snapshot(), {
		idle: false,
		pendingMessages: false,
		now: 10_000,
	});
	assert.match(output, /Tool: subagent — Review tests \(8s\)/);
	assert.match(output, /Child model: openai-codex\/gpt-test · thinking: high/);
	assert.match(output, /Child activity \(7s\): running npm test/);
	assert.match(output, /Child event: 2s ago · stall timeout: 30s \(28s remaining\)/);
	assert.match(output, /Child session: child-id/);
});
