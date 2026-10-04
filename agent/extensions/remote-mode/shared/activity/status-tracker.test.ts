import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityTracker, formatCommandActivity, formatRemoteRunActivity, formatSubagentActivity, renderActivityStatus } from "./status-tracker.js";

test("remote run activity shows shell-like commands and observable phases on one line", () => {
	const args = { args: ["bun", "run", "test:e2e"] };
	assert.equal(formatRemoteRunActivity(args), "remote_run bun run test:e2e · starting");
	assert.equal(formatRemoteRunActivity(args, { details: { phase: "queued", jobId: "job-42" } }),
		"remote_run bun run test:e2e · queued · job-42");
	assert.equal(formatRemoteRunActivity(args, { details: { command: "bun run test:e2e", phase: "running", jobId: "job-42", runner: "worker-1" } }),
		"remote_run bun run test:e2e · running · job-42 · runner: worker-1");
	assert.equal(formatRemoteRunActivity({ args: ["printf", "hello world", "line\nend"] }, { details: { phase: "queued\nwait", runner: "worker\n1" } }),
		`remote_run printf 'hello world' "line\\nend" · queued\\x0await · runner: worker\\x0a1`);
	for (const partial of [undefined, null, 42, "bad", { details: null }, { details: [] }, { details: { phase: 3, command: {}, runner: [] } }]) {
		assert.equal(formatRemoteRunActivity(args, partial), "remote_run bun run test:e2e · starting");
	}
	assert.equal(formatRemoteRunActivity({ args: ["bun", 42] }), "remote_run · starting");
});

test("remote run activity reports final outcome, exit and elapsed without a live clock", () => {
	const args = { args: ["bun", "run", "test:e2e"] };
	const details = { phase: "running", status: "running", jobId: "job-42", runner: "worker-1", startedAt: 1_000, phaseStartedAt: 2_000, lastProgressAt: 2_000, exitCode: null };
	const tracker = new ActivityTracker(0);
	tracker.startTool("remote", "remote_run", args, 1_000);
	const updates: string[] = [];
	for (let now = 2_000; now <= 5_000; now += 1_000) {
		const previous = tracker.snapshot().activeTools[0];
		const partial = { details: { ...details } };
		tracker.updateTool("remote", partial, now);
		const preview = formatRemoteRunActivity(args, partial);
		if (preview !== formatRemoteRunActivity(args, previous.partialResult)) updates.push(preview);
	}
	assert.deepEqual(updates, ["remote_run bun run test:e2e · running · job-42 · runner: worker-1"]);
	for (const [status, exit] of [["completed", 0], ["failed", 1], ["cancelled", null], ["cancellation_unconfirmed", null]] as const) {
		assert.equal(formatRemoteRunActivity(args, { details: { ...details, status, phase: status, exitCode: exit, finishedAt: 66_000 } }),
			`remote_run bun run test:e2e · ${status} · job-42 · runner: worker-1 · exit: ${exit ?? "unknown"} · 1m 5s`);
	}
	assert.equal(formatRemoteRunActivity(args, undefined, "failed"), "remote_run bun run test:e2e · failed · exit: unknown");
});

test("active remote run status exposes command, phase, job, runner and output", () => {
	const tracker = new ActivityTracker(0);
	tracker.start(1_000);
	tracker.startTool("remote", "remote_run", { args: ["bun", "run", "test:e2e"] }, 2_000);
	const render = (now: number) => renderActivityStatus(tracker.snapshot(), { idle: false, pendingMessages: false, now });
	assert.match(render(3_000), /Tool: remote_run[\s\S]*Command: bun run test:e2e[\s\S]*Remote phase: starting/);
	tracker.updateTool("remote", { details: { command: "bun run test:e2e", phase: "queued", jobId: "job-42", runner: "worker\n1", outputPath: "/tmp/output.log", diagnosticsPath: "/tmp/diagnostics.log" } }, 3_000);
	assert.match(render(4_000), /Command: bun run test:e2e\nRemote phase: queued\nJob: job-42\nRunner: worker\\x0a1\nOutput: \/tmp\/output.log\nDiagnostics: \/tmp\/diagnostics.log/);
	tracker.updateTool("remote", { details: null }, 5_000);
	assert.match(render(6_000), /Command: bun run test:e2e[\s\S]*Remote phase: starting/);
	tracker.endTool("remote", false, 7_000);
	assert.doesNotMatch(render(8_000), /remote_run|output.log/);
});

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
