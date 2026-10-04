import assert from "node:assert/strict";
import { test } from "node:test";
import register from "./index.ts";
import { tokenStatus } from "../remote-mode/shared/hosted/token-commands.ts";

function fixture() {
 let tool: any;
 // No lifecycle handlers or mutating APIs: registration/execution must remain read-only.
 register({ registerTool(definition: any) { tool = definition; } } as any);
 const ctx = {
  model: { provider: "test", id: "one", contextWindow: 10000 },
  getContextUsage: (): any => ({ tokens: 2500, contextWindow: 10000, percent: 25 }),
  sessionManager: { getEntries: (): any[] => [] },
 };
 const execute = () => tool.execute("id", {}, undefined, undefined, ctx);
 return { tool, ctx, execute };
}

const usage = { input: 100, output: 20, cacheRead: 900, cacheWrite: 50, cost: { total: 0.01 } };

test("registers a direct read-only tool with empty inputs, structured output and check guidance", () => {
 const { tool } = fixture();
 assert.equal(tool.name, "token_status");
 assert.equal(tool.exposure ?? "direct", "direct");
 assert.deepEqual(tool.parameters.properties, {});
 assert.ok(tool.outputSchema);
 assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
 assert.match(tool.promptGuidelines.join("\n"), /not every turn/);
});

test("reports context capacity separately from cumulative spend and shares remote aggregation", async () => {
 const { ctx, execute } = fixture();
 const entries = [
  { type: "message", message: { role: "assistant", usage } },
  { type: "message", message: { role: "toolResult", usage } },
  { type: "compaction", usage },
  { type: "branch_summary", usage },
  { type: "usage", usage },
  { type: "message", message: { role: "user", usage } },
  { type: "custom", usage },
 ];
 ctx.sessionManager.getEntries = () => entries;
 const result = await execute();
 const data = result.structuredContent;
 assert.deepEqual(data.model, { provider: "test", id: "one" });
 assert.deepEqual(data.context, { estimated: true, tokens: 2500, contextWindow: 10000, percent: 25, remainingTokens: 7500 });
 assert.deepEqual(data.sessionUsage, {
  scope: "all recorded session entries", input: 500, output: 100, cacheRead: 4500, cacheWrite: 250,
  estimatedCostUsd: 0.05, latestCacheHitPercent: 900 / 1050 * 100,
 });
 assert.deepEqual(JSON.parse(result.content[0].text), data);
 assert.deepEqual(result.details, data);
 assert.equal(tokenStatus({ entries, contextWindow: 10000, percent: 25 }), "↑500 ↓100 R4.5k W250 CH85.7% $0.050 25.0%/10k");
});

test("reads fresh state per call, respects effective context window and clamps remaining capacity", async () => {
 const { ctx, execute } = fixture();
 assert.equal((await execute()).structuredContent.context.remainingTokens, 7500);
 ctx.model.id = "two";
 ctx.getContextUsage = () => ({ tokens: 6000, contextWindow: 5000, percent: 120 });
 ctx.sessionManager.getEntries = () => [{ type: "usage", usage }];
 const data = (await execute()).structuredContent;
 assert.equal(data.model.id, "two");
 assert.equal(data.context.contextWindow, 5000);
 assert.equal(data.context.remainingTokens, 0);
 assert.equal(data.sessionUsage.input, 100);
});

test("preserves unknown context after compaction instead of inferring it from spend", async () => {
 const { ctx, execute } = fixture();
 ctx.getContextUsage = () => ({ tokens: null, contextWindow: 10000, percent: null });
 ctx.sessionManager.getEntries = () => [{ type: "compaction", usage }];
 const data = (await execute()).structuredContent;
 assert.deepEqual(data.context, { estimated: true, tokens: null, contextWindow: 10000, percent: null, remainingTokens: null });
 assert.equal(data.sessionUsage.input, 100);
 assert.equal(data.sessionUsage.latestCacheHitPercent, null);
});

test("missing context falls back only for window size, missing model/window stay unknown", async () => {
 const { ctx, execute } = fixture();
 ctx.getContextUsage = () => undefined;
 assert.deepEqual((await execute()).structuredContent.context, { estimated: true, tokens: null, contextWindow: 10000, percent: null, remainingTokens: null });
 (ctx as any).model = undefined;
 const data = (await execute()).structuredContent;
 assert.equal(data.model, null);
 assert.equal(data.context.contextWindow, null);
 assert.equal(data.sessionUsage.input, 0);
 assert.equal(data.sessionUsage.latestCacheHitPercent, null);
 ctx.getContextUsage = () => ({ tokens: null, contextWindow: 0, percent: null });
 assert.equal((await execute()).structuredContent.context.contextWindow, null);
});

test("latest assistant cache hit rate is unknown for an empty prompt", async () => {
 const { ctx, execute } = fixture();
 ctx.sessionManager.getEntries = () => [
  { type: "message", message: { role: "assistant", usage } },
  { type: "message", message: { role: "assistant", usage: { ...usage, input: 0, cacheRead: 0, cacheWrite: 0 } } },
 ];
 assert.equal((await execute()).structuredContent.sessionUsage.latestCacheHitPercent, null);
});
