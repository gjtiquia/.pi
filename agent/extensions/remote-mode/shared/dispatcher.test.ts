import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySharedCommand, createCommandDispatcher, type CommandHost } from "./index.js";

function fixture() {
 const sent: unknown[] = [];
 let stopped = false;
 const host: CommandHost = {
  cwd: process.cwd(), projectTrusted: false,
  isIdle: () => false, hasPendingMessages: () => true,
  abort: () => { stopped = true; },
  compact: async () => {},
  sendUserMessage: (text, options) => { sent.push([text, options]); },
  getSkills: () => [{ name: "skill:review", source: "skill" }],
  model: { current: () => ({ provider: "test", id: "one" }), list: () => [{ provider: "test", id: "one" }], set: async () => true, getEffort: () => "low", setEffort: () => {} },
  tokens: () => ({ entries: [], contextWindow: 10000, percent: 25 }),
 };
 return { host, sent, stopped: () => stopped };
}

test("shared catalog identifies standalone and session commands without host-specific routing lists", () => {
 assert.equal(classifySharedCommand("!help"), "standalone");
 assert.equal(classifySharedCommand("!$ pwd"), "standalone");
 assert.equal(classifySharedCommand("!skill list"), "session");
 assert.equal(classifySharedCommand("!stop"), "session");
 assert.equal(classifySharedCommand("!compact this"), "session");
 assert.equal(classifySharedCommand("!compress this"), "session");
 assert.equal(classifySharedCommand("!unknown"), undefined);
});

test("shared dispatcher owns routing, catalog composition and unknown fallback", async () => {
 const { host } = fixture();
 const dispatch = createCommandDispatcher(host, [{ name: "local", usage: ["!local status"], actions: { status: { args: "none", run: () => "local status" } } }]);
 assert.deepEqual(await dispatch("!unknown"), { handled: false });
 assert.deepEqual(await dispatch("plain prompt"), { handled: false });
 assert.equal((await dispatch("!local status")).response, "local status");
 const help = (await dispatch("!ls")).response!;
 for (const name of ["!git", "!shell", "!skill", "!model", "!tokens", "!local"]) assert.ok(help.includes(name));
 assert.equal((await dispatch("!tokens status")).response, "25.0%/10k");
 assert.equal((await dispatch("!model status")).response, "Model: test/one\nThinking: low");
});

test("shared dispatcher preserves prompt text and session delivery semantics", async () => {
 const f = fixture(); const dispatch = createCommandDispatcher(f.host);
 await dispatch("!queue first\n  second");
 await dispatch("!steer adjust\n  this");
 await dispatch("!skill review inspect\n  this");
 assert.deepEqual(f.sent, [["first\n  second", { deliverAs: "followUp" }], ["adjust\n  this", { deliverAs: "steer" }], ["/skill:review inspect\n  this", { deliverAs: "followUp", expandPromptTemplates: true }]]);
 assert.equal((await dispatch("!abort extra")).response?.startsWith("Usage:"), true);
 assert.equal(f.stopped(), false);
 await dispatch("!abort"); assert.equal(f.stopped(), true);
});

test("compact aliases require this, an idle session, and report completion or failure", async () => {
 const { host } = fixture();
 let calls = 0;
 host.compact = async () => { calls++; };
 const dispatch = createCommandDispatcher(host);
 assert.match((await dispatch("!compact")).response!, /!compact this/);
 assert.match((await dispatch("!compress help")).response!, /!compress this/);
 assert.match((await dispatch("!compact other")).response!, /Usage:/);
 assert.match((await dispatch("!compact this extra")).response!, /Usage:/);
 assert.match((await dispatch("!compact this")).response!, /busy/);
 assert.equal(calls, 0);
 host.isIdle = () => true;
 assert.match((await dispatch("!compress this")).response!, /busy/);
 host.hasPendingMessages = () => false;
 assert.equal((await dispatch("!compress this")).response, "Compaction complete.");
 assert.equal(calls, 1);
 host.compact = async () => { throw new Error("Nothing to compact (session too small)"); };
 assert.match((await dispatch("!compact this")).response!, /Compaction failed: Nothing to compact/);
});

test("standalone commands use host cwd and trusted project shell settings", async () => {
 const { host } = fixture();
 const cwd = await mkdtemp(join(tmpdir(), "shared-dispatch-"));
 try {
  host.cwd = cwd;
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ shellPath: "/bin/sh", shellCommandPrefix: "export SHARED_DISPATCH_TEST=trusted-prefix" }));
  const command = "!shell printf '%s' \"${SHARED_DISPATCH_TEST-untrusted}\"; pwd";
  assert.match((await createCommandDispatcher(host)(command)).response!, /untrusted/);
  host.projectTrusted = true;
  const dispatch = createCommandDispatcher(host);
  assert.match((await dispatch(command)).response!, /trusted-prefix/);
  assert.ok((await dispatch("!$ pwd")).response!.includes(cwd));
  assert.match((await dispatch("!git init -q")).response!, /exit 0/);
  assert.ok((await dispatch("!git rev-parse --show-toplevel")).response!.includes(cwd));
 } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("model validation and token aggregation stay shared", async () => {
 const { host } = fixture(); const selected: unknown[] = [];
 host.model.set = async (model) => { selected.push(model); return false; };
 const dispatch = createCommandDispatcher(host);
 assert.match((await dispatch("!model set model missing")).response!, /Model not found/);
 assert.equal(selected.length, 0);
 assert.match((await dispatch("!model set model one")).response!, /Authentication is not configured/);
 assert.deepEqual(selected, [{ provider: "test", id: "one" }]);
 assert.match((await dispatch("!model set effort invalid")).response!, /Invalid effort/);
 const usage = { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: { total: 0.01 } };
 host.tokens = () => ({ entries: [{ type: "message", message: { role: "assistant", usage } }, { type: "compaction", usage }], contextWindow: 10000 });
 assert.equal((await dispatch("!token status")).response, "↑200 ↓40 R1.8k CH90.0% $0.020 ?/10k");
});
