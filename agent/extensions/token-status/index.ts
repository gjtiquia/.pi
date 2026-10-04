import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { calculateTokenUsage } from "../remote-mode/shared/hosted/token-commands.js";

const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const resultSchema = Type.Object({
 model: Type.Union([Type.Object({ provider: Type.String(), id: Type.String() }), Type.Null()]),
 context: Type.Object({
  estimated: Type.Literal(true),
  tokens: nullableNumber,
  contextWindow: nullableNumber,
  percent: nullableNumber,
  remainingTokens: nullableNumber,
 }),
 sessionUsage: Type.Object({
  scope: Type.Literal("all recorded session entries"),
  input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(),
  estimatedCostUsd: Type.Number(), latestCacheHitPercent: nullableNumber,
 }),
});

export default function tokenStatusExtension(pi: ExtensionAPI): void {
 pi.registerTool({
  name: "token_status",
  label: "Token Status",
  description: "Read the current session's estimated context occupancy and remaining capacity, cumulative recorded token usage and estimated cost, and active model. Cumulative spend is not remaining context budget. Unknown context estimates are returned as null; remaining capacity is not an output-token allowance. Does not compact or change the session.",
  promptSnippet: "Check context capacity and cumulative token spend without changing the session.",
  promptGuidelines: ["For long-running work, use token_status before a large investigation, after substantial tool output, or before preparing a handoff—not every turn. Treat context figures as estimates and cumulative session usage as spend, not remaining context budget."],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  parameters: Type.Object({}),
  outputSchema: resultSchema,
  async execute(_id, _params, _signal, _onUpdate, ctx) {
   const context = ctx.getContextUsage();
   const window = context?.contextWindow ?? ctx.model?.contextWindow;
   const contextWindow = window != null && window > 0 ? window : null;
   const tokens = context?.tokens ?? null;
   const usage = calculateTokenUsage(ctx.sessionManager.getEntries());
   const data = {
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
    context: {
     estimated: true as const,
     tokens,
     contextWindow,
     percent: context?.percent ?? null,
     remainingTokens: tokens !== null && contextWindow !== null ? Math.max(0, contextWindow - tokens) : null,
    },
    sessionUsage: {
     scope: "all recorded session entries" as const,
     input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
     estimatedCostUsd: usage.cost, latestCacheHitPercent: usage.latestCacheHitRate,
    },
   };
   return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: data, structuredContent: data };
  },
 });
}
