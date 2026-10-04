import { resolveHost } from "./test/preload.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, mock, test } from "bun:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { MODEL_SELECTION_GUIDANCE } from "../../preferences/model-tiers.ts";

const directory = await mkdtemp(join(tmpdir(), "subagent-selection-"));
const cli = join(directory, "fake-cli.ts");
await writeFile(cli, `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = args[args.indexOf("--session-dir") + 1];
const id = "selection-child";
const timestamp = "2026-10-01T00:00:00.000Z";
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, timestamp.replace(/[:.]/g, "-") + "_" + id + ".jsonl"), "{}\\n");
console.log(JSON.stringify({ type: "session", id, timestamp }));
const response = args.at(-1) === "large-output" ? "x".repeat(120_000) : JSON.stringify(args);
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{type: "text", text: response}], stopReason: "stop" }}));
`);
// Only replace the process-invocation boundary: model resolution, child argv,
// metadata persistence and the actual subprocess/event loop run unchanged.
const { getPiInvocation: originalInvocation } = await import("./invocation.ts");
mock.module("./invocation.ts", () => ({ getPiInvocation: (args: string[]) => ({ command: process.execPath, args: [cli, ...args] }) }));
afterAll(() => { mock.module("./invocation.ts", () => ({ getPiInvocation: originalInvocation })); });
const { default: register } = await import("./index.ts");
let tool!: ToolDefinition<any, any>;
register({ registerTool(value: ToolDefinition<any, any>) { tool = value; }, getActiveTools() { return ["read"]; }, events: { emit() {} } } as unknown as ExtensionAPI);
const available = [
  { provider: "openai-codex", id: "gpt-6-luna", reasoning: true, thinkingLevelMap: { off: "none", xhigh: "xhigh", max: "max" } },
  { provider: "openai-codex", id: "gpt-6.1-sol", reasoning: true },
  { provider: "other", id: "plain", reasoning: false },
] as Model<any>[];
const ctx = {
  cwd: directory,
  model: { provider: "openai-codex", id: "parent" },
  thinkingLevel: "low",
  sessionManager: { getSessionId() { return "parent"; }, getSessionFile() { return join(directory, "parent.jsonl"); } },
  modelRegistry: { getAvailable() { return available; } },
} as unknown as ExtensionToolContext;
const base = { summary: "Check settings", task: "Return arguments", stallTimeoutSeconds: 25 };
const execute = (selection: Record<string, unknown>, context = ctx) => tool.execute("call", { ...base, ...selection }, undefined, undefined, context);

test("test aliases expose the actual installed Pi exports", async () => {
  for (const [specifier, symbol] of [
    ["@earendil-works/pi-ai", "getSupportedThinkingLevels"],
    ["@earendil-works/pi-coding-agent", "truncateHead"],
    ["@earendil-works/pi-tui", "Text"],
    ["typebox", "Type"],
  ]) {
    const aliased = await import(specifier);
    const installed = await import(resolveHost(specifier));
    assert.ok(installed[symbol]);
    assert.equal(aliased[symbol], installed[symbol]);
  }
});

test("tool schema permits bundled presets and consumes centralized guidance", () => {
  const schema = tool.parameters as any;
  assert.ok(!schema.required.includes("thinkingLevel"));
  assert.ok(!schema.required.includes("modelTier"));
  assert.ok(schema.properties.model);
  assert.ok(!JSON.stringify(schema.properties.modelTier).includes('"inherit"'));
  for (const guidance of MODEL_SELECTION_GUIDANCE) assert.ok(tool.promptGuidelines?.includes(guidance));
});

test("delegation guidance bounds work without adding tool fields", () => {
  const guidance = tool.promptGuidelines?.join("\n") ?? "";
  for (const requirement of [
    "bounded outcome and stopping condition in task",
    "For coding tasks, explicitly assign verification ownership",
    "report work beyond your assigned scope to the parent",
    "coordinate combined checks to avoid duplicate verification",
    "explain material scope expansion to the user before proceeding",
  ]) assert.ok(guidance.includes(requirement));
  assert.deepEqual(Object.keys((tool.parameters as any).properties).sort(), [
    "model", "modelTier", "resumeSessionId", "stallTimeoutSeconds",
    "summary", "task", "thinkingLevel",
  ].sort());
});

test("invalid choices reject before invoking a child", async () => {
  await assert.rejects(execute({ thinkingLevel: "max" }), /exactly one/);
  await assert.rejects(execute({ model: "other/plain" }), /explicit supported thinkingLevel/);
  await assert.rejects(execute({ modelTier: "fast", thinkingLevel: "medium" }), /bundles thinkingLevel/);
  await assert.rejects(execute({ modelTier: "fast", model: "other/plain", thinkingLevel: "low" }), /exactly one/);
  await assert.rejects(execute({ modelTier: "inherit", thinkingLevel: "high" }), /Unknown model tier/);
  await assert.rejects(execute({ model: "other/missing", thinkingLevel: "low" }), /unavailable/);
  await assert.rejects(execute({ model: "other/plain", thinkingLevel: "max" }), /does not support/);
});

test("child argv, details and metadata use explicit settings, not the parent's thinking", async () => {
  const result = await execute({ modelTier: "balanced" });
  const args = JSON.parse((result.content[0] as any).text);
  assert.match((result.content[1] as any).text, /Child session ID: selection-child/);
  assert.match((result.content[1] as any).text, /Child session path: .*selection-child\.jsonl/);
  assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-6-luna");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  assert.equal(result.details.thinkingLevel, "high");
  const metadata = JSON.parse(await readFile(join(directory, "subagent-sessions", "parent", ".metadata", "selection-child.json"), "utf8"));
  assert.equal(metadata.modelId, "gpt-6-luna");
  assert.equal(metadata.thinkingLevel, "high");
  assert.equal(metadata.modelTier, "balanced");
});

test("resume preserves the saved model/thinking even when the parent's provider changes", async () => {
  const changedParent = { ...ctx, model: { provider: "opencode-go", id: "parent" }, thinkingLevel: "high" } as ExtensionToolContext;
  const result = await execute({ modelTier: "balanced", resumeSessionId: "selection-child" }, changedParent);
  const args = JSON.parse((result.content[0] as any).text);
  assert.ok(args.includes("--session"));
  assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-6-luna");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  await assert.rejects(execute({ model: "openai-codex/gpt-6-luna", thinkingLevel: "max", resumeSessionId: "selection-child" }), /must preserve/);
});

test("truncated output points to a readable final-response artifact in a separate block", async () => {
  const result = await execute({ task: "large-output", modelTier: "balanced" });
  const outputBlock = result.content[0] as { type: string; text: string };
  const contextBlock = result.content[1] as { type: string; text: string };
  assert.equal(outputBlock.type, "text");
  assert.equal(contextBlock.type, "text");
  assert.ok(outputBlock.text.length < 120_000);
  assert.doesNotMatch(outputBlock.text, /Child session ID/);
  assert.match(contextBlock.text, /Child session ID: selection-child/);
  assert.match(contextBlock.text, /Child session path: .*selection-child\.jsonl/);
  const artifactPath = result.details.finalOutputPath;
  assert.equal(typeof artifactPath, "string");
  assert.ok(contextBlock.text.includes(`Full final assistant response saved to ${artifactPath}`));
  assert.equal(await readFile(artifactPath, "utf8"), "x".repeat(120_000));
});

test("fast and deep launch their bundled thinking presets", async () => {
  for (const [modelTier, modelId, thinkingLevel] of [["fast", "gpt-6-luna", "medium"], ["deep", "gpt-6.1-sol", "high"]]) {
    const result = await execute({ modelTier });
    const args = JSON.parse((result.content[0] as any).text);
    assert.equal(args[args.indexOf("--model") + 1], `openai-codex/${modelId}`);
    assert.equal(args[args.indexOf("--thinking") + 1], thinkingLevel);
    assert.equal(result.details.thinkingLevel, thinkingLevel);
  }
});

test("explicit model can cross providers without inheriting the parent", async () => {
  const result = await execute({ model: "other/plain", thinkingLevel: "off" });
  const args = JSON.parse((result.content[0] as any).text);
  assert.equal(args[args.indexOf("--model") + 1], "other/plain");
  assert.equal(args[args.indexOf("--thinking") + 1], "off");
});
