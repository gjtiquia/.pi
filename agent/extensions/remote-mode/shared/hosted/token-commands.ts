import type { TokenEntry, TokenSnapshot } from "../host.js";

function formatTokens(count: number): string {
 if (count < 1000) return String(count);
 if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
 if (count < 1000000) return `${Math.round(count / 1000)}k`;
 if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
 return `${Math.round(count / 1000000)}M`;
}

/** Cumulative recorded spend across supplied session entries, not context occupancy. */
export function calculateTokenUsage(entries: readonly TokenEntry[]) {
 const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
 let latestCacheHitRate: number | undefined;
 for (const entry of entries) {
  const usage = entry.type === "usage" ? entry.usage
   : entry.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult") ? entry.message.usage
   : (entry.type === "branch_summary" || entry.type === "compaction") ? entry.usage : undefined;
  if (!usage) continue;
  totals.input += usage.input; totals.output += usage.output;
  totals.cacheRead += usage.cacheRead; totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
  if (entry.type === "message" && entry.message?.role === "assistant") {
   const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
   latestCacheHitRate = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
  }
 }
 return { ...totals, latestCacheHitRate: latestCacheHitRate ?? null };
}

export function tokenStatus(snapshot: TokenSnapshot): string {
 const totals = calculateTokenUsage(snapshot.entries);
 const latestCacheHitRate = totals.latestCacheHitRate;
 const parts: string[] = [];
 if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
 if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
 if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
 if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
 if ((totals.cacheRead || totals.cacheWrite) && latestCacheHitRate !== null) parts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
 if (totals.cost) parts.push(`$${totals.cost.toFixed(3)}`);
 parts.push(`${snapshot.percent == null ? "?" : snapshot.percent.toFixed(1) + "%"}/${formatTokens(snapshot.contextWindow)}`);
 return parts.join(" ");
}
