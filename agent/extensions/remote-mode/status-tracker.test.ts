import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityTracker, formatCommandActivity, renderActivityStatus } from "./status-tracker.js";

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

test("labels the hard Mattermost activity-post limit", () => {
	const activity = formatCommandActivity("bash", "abcdefgh", 5);
	assert.match(activity.text, /abcde/);
	assert.match(activity.text, /3 command characters omitted only because Mattermost/);
});

test("adds structured subagent diagnostics without making status subagent-specific", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	tracker.startTool("child", "subagent", { summary: "Review tests" }, 2_000);
	tracker.updateTool("child", {
		details: {
			summary: "Review tests",
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
	assert.match(output, /Child activity \(7s\): running npm test/);
	assert.match(output, /Child event: 2s ago · stall timeout: 30s \(28s remaining\)/);
	assert.match(output, /Child session: child-id/);
});
