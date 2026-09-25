export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelRef { provider: string; id: string }
export interface ModelHost {
 current(): ModelRef | undefined;
 list(): ModelRef[];
 /** Called only for a catalog member. False means authentication is missing. */
 set(model: ModelRef): Promise<boolean>;
 getEffort(): string;
 setEffort(effort: Effort): void;
}
export interface TokenUsage {
 input: number; output: number; cacheRead: number; cacheWrite: number;
 cost: { total: number };
}
/** Structural subset of Pi entries; unrelated entry kinds are ignored. */
export interface TokenEntry {
 type: string;
 usage?: TokenUsage;
 message?: { role: string; usage?: TokenUsage };
}
export interface TokenSnapshot {
 entries: readonly TokenEntry[];
 percent?: number | null;
 contextWindow: number;
}
export interface CommandHost {
 cwd: string;
 projectTrusted: boolean;
 isIdle(): boolean;
 hasPendingMessages(): boolean;
 /** Abort current work AND clear pending messages. */
 abort(): void;
 /** Compact the active Pi session; resolve on completion, reject on failure. Requires a live session. */
 compact(): Promise<void>;
 sendUserMessage(prompt: string, options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean }): void;
 getSkills(): { name: string; description?: string; source: string }[];
 model: ModelHost;
 tokens(): TokenSnapshot;
}
