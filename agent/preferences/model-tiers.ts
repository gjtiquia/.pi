// Canonical selection policy shared by subagents and Gateway cron.
// Keep this module free of Pi runtime dependencies so it can be vendored.
export const MODEL_TIERS = {
  "openai-codex": {
    fast: "gpt-6-luna",
    balanced: "gpt-6.1-sol",
    deep: "gpt-6-astra",
  },
  "opencode-go": {
    fast: "deepseek-v4.1-flash",
    balanced: "glm-5.3-flash",
    deep: "kimi-k3",
  },
} as const;

export const MODEL_TIER_VALUES = ["fast", "balanced", "deep"] as const;
export type ModelTier = (typeof MODEL_TIER_VALUES)[number];
export type RoutedModelTier = ModelTier;
export const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

export const MODEL_TIER_DESCRIPTION = "Model tier within the active provider: fast for well-scoped work, balanced for ambiguity and normal review, deep for difficult judgment. No inheritance or fallback.";
export const MODEL_DESCRIPTION = "Explicit provider/model-id instead of modelTier; may select a different provider. Choose exactly one of model or modelTier.";
export const THINKING_LEVEL_DESCRIPTION = "Required explicit Pi thinking level (provider reasoning effort). Choose independently of model capability; the selected model must support it. No inheritance or silent adjustment.";
export const MODEL_SELECTION_GUIDANCE = [
  "Explicitly choose exactly one of modelTier or model, and always choose thinkingLevel. No default selection, inherit option, or silent fallback. Tiers stay within the active provider; explicit provider/model-id can cross providers.",
  "Choose model capability for the judgment and ambiguity required: fast for mechanical lookup, narrow checks, and implementation with explicit requirements; balanced for ambiguous coding and normal review; deep for difficult architecture, debugging, or synthesis. Use an explicit model when a specific model is needed.",
  "Choose thinkingLevel independently for reasoning depth: off/minimal/low for simple supported tasks, medium for routine multi-step work, high/xhigh for harder planning and checks, max when depth matters more than latency and usage. More thinking does not substitute for a stronger model. A fast-tier model at max is a patient, economical worker, not necessarily fast or suitable for ambiguous architectural decisions.",
] as const;
export const MODEL_SELECTION_DESCRIPTION = MODEL_SELECTION_GUIDANCE.join(" ");

export interface ModelSelection {
  model?: string;
  modelTier?: ModelTier;
  thinkingLevel: ThinkingLevel;
}
export interface ModelIdentity { provider: string; id: string }
export interface ResolvedModelSelection extends ModelIdentity { thinkingLevel: ThinkingLevel }

export function validateModelSelection(selection: { model?: unknown; modelTier?: unknown; thinkingLevel?: unknown }): asserts selection is ModelSelection {
  if ((selection.model !== undefined) === (selection.modelTier !== undefined)) throw new Error("Choose exactly one of model or modelTier");
  if (selection.model !== undefined && (typeof selection.model !== "string" || !/^[^\s/]+\/\S+$/.test(selection.model))) throw new Error("Model must be provider/model-id without whitespace");
  if (selection.modelTier !== undefined && !MODEL_TIER_VALUES.includes(selection.modelTier as ModelTier)) throw new Error("Unknown model tier");
  if (!THINKING_LEVEL_VALUES.includes(selection.thinkingLevel as ThinkingLevel)) throw new Error("Choose an explicit supported thinkingLevel");
}

export function resolveModelRoute(
  modelTier: ModelTier,
  activeModel: ModelIdentity | undefined,
  modelExists: (provider: string, id: string) => boolean,
): ModelIdentity {
  if (!MODEL_TIER_VALUES.includes(modelTier)) throw new Error("Unknown model tier");
  if (!activeModel) throw new Error("No active provider is available for modelTier; choose an explicit model");
  const routes = MODEL_TIERS[activeModel.provider as keyof typeof MODEL_TIERS];
  const id = routes?.[modelTier];
  if (!id) throw new Error(`No ${modelTier} route is configured for ${activeModel.provider}`);
  if (!modelExists(activeModel.provider, id)) throw new Error(`${activeModel.provider}/${id} is unavailable`);
  return { provider: activeModel.provider, id };
}

// Callers supply Pi's supported-level lookup; provider translation belongs to Pi.
export function resolveModelSelection(
  selection: ModelSelection,
  activeModel: ModelIdentity | undefined,
  supportedLevels: (provider: string, id: string) => readonly string[] | undefined,
): ResolvedModelSelection {
  validateModelSelection(selection);
  const route = selection.model !== undefined
    ? { provider: selection.model.slice(0, selection.model.indexOf("/")), id: selection.model.slice(selection.model.indexOf("/") + 1) }
    : resolveModelRoute(selection.modelTier!, activeModel, (provider, id) => supportedLevels(provider, id) !== undefined);
  const levels = supportedLevels(route.provider, route.id);
  if (!levels) throw new Error(`${route.provider}/${route.id} is unavailable`);
  if (!levels.includes(selection.thinkingLevel)) throw new Error(`${route.provider}/${route.id} does not support thinkingLevel ${selection.thinkingLevel}; supported: ${levels.join(", ")}`);
  return { ...route, thinkingLevel: selection.thinkingLevel };
}
