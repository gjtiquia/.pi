// Canonical selection policy shared by subagents and Gateway cron.
// Keep this module free of Pi runtime dependencies so it can be vendored.
export const MODEL_TIERS = {
  "openai-codex": {
    fast: { id: "gpt-6-luna", thinkingLevel: "medium" },
    balanced: { id: "gpt-6-luna", thinkingLevel: "max" },
    deep: { id: "gpt-6.1-sol", thinkingLevel: "medium" },
  },
  "opencode-go": {
    fast: { id: "deepseek-v4.1-flash", thinkingLevel: "medium" },
    balanced: { id: "glm-5.3-flash", thinkingLevel: "medium" },
    deep: { id: "kimi-k3", thinkingLevel: "medium" },
  },
} as const;

export const MODEL_TIER_VALUES = ["fast", "balanced", "deep"] as const;
export type ModelTier = (typeof MODEL_TIER_VALUES)[number];
export type RoutedModelTier = ModelTier;
export const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

export const MODEL_TIER_DESCRIPTION = "Execution preset bundling model and thinking within the active provider. Codex: fast = Luna medium, balanced = Luna max, deep = Sol medium. Omit thinkingLevel with a tier. No inheritance or fallback.";
export const MODEL_DESCRIPTION = "Explicit provider/model-id instead of modelTier; requires thinkingLevel and may select a different provider. Prefer tier presets unless a specific model/effort is needed.";
export const THINKING_LEVEL_DESCRIPTION = "Required only with an explicit model; forbidden with modelTier, which bundles thinking. The selected model must support it. No inheritance or silent adjustment.";
export const MODEL_SELECTION_GUIDANCE = [
  "Choose either modelTier alone (bundled model and thinking) or an explicit model plus thinkingLevel. Never supply thinkingLevel with modelTier. No inherit option or silent fallback. Tiers stay within the active provider; explicit provider/model-id can cross providers.",
  "Default to balanced for scoped implementation and analysis. Use fast for mechanical lookup, edits, and bounded checks. Use deep only when the delegated task itself requires difficult judgment, ambiguous debugging, or architecture—not merely because the overall project is important. Codex presets: fast = Luna medium, balanced = Luna max, deep = Sol medium.",
  "Delegation often isolates context rather than outsourcing harder judgment. Keep difficult orchestration decisions in the main session and give cheaper workers bounded assignments. Prefer presets; reserve explicit model plus thinkingLevel for user-requested selections or tasks that genuinely need a specific model/effort. More thinking does not make a cheaper model equivalent to a stronger one.",
] as const;
export const MODEL_SELECTION_DESCRIPTION = MODEL_SELECTION_GUIDANCE.join(" ");

export interface ModelSelection {
  model?: string;
  modelTier?: ModelTier;
  thinkingLevel?: ThinkingLevel;
}
export interface ModelIdentity { provider: string; id: string }
export interface ResolvedModelSelection extends ModelIdentity { thinkingLevel: ThinkingLevel }

export function validateModelSelection(selection: { model?: unknown; modelTier?: unknown; thinkingLevel?: unknown }): asserts selection is ModelSelection {
  if ((selection.model !== undefined) === (selection.modelTier !== undefined)) throw new Error("Choose exactly one of model or modelTier");
  if (selection.model !== undefined && (typeof selection.model !== "string" || !/^[^\s/]+\/\S+$/.test(selection.model))) throw new Error("Model must be provider/model-id without whitespace");
  if (selection.modelTier !== undefined) {
    if (!MODEL_TIER_VALUES.includes(selection.modelTier as ModelTier)) throw new Error("Unknown model tier");
    if (selection.thinkingLevel !== undefined) throw new Error("modelTier bundles thinkingLevel; omit thinkingLevel or use an explicit model plus thinkingLevel");
  } else if (!THINKING_LEVEL_VALUES.includes(selection.thinkingLevel as ThinkingLevel)) {
    throw new Error("Choose an explicit supported thinkingLevel with model");
  }
}

export function resolveModelRoute(
  modelTier: ModelTier,
  activeModel: ModelIdentity | undefined,
  modelExists: (provider: string, id: string) => boolean,
): ResolvedModelSelection {
  if (!MODEL_TIER_VALUES.includes(modelTier)) throw new Error("Unknown model tier");
  if (!activeModel) throw new Error("No active provider is available for modelTier; choose an explicit model");
  const routes = MODEL_TIERS[activeModel.provider as keyof typeof MODEL_TIERS];
  const preset = routes?.[modelTier];
  if (!preset) throw new Error(`No ${modelTier} route is configured for ${activeModel.provider}`);
  if (!modelExists(activeModel.provider, preset.id)) throw new Error(`${activeModel.provider}/${preset.id} is unavailable`);
  return { provider: activeModel.provider, ...preset };
}

// Callers supply Pi's supported-level lookup; provider translation belongs to Pi.
export function resolveModelSelection(
  selection: ModelSelection,
  activeModel: ModelIdentity | undefined,
  supportedLevels: (provider: string, id: string) => readonly string[] | undefined,
): ResolvedModelSelection {
  validateModelSelection(selection);
  const route = selection.model !== undefined
    ? { provider: selection.model.slice(0, selection.model.indexOf("/")), id: selection.model.slice(selection.model.indexOf("/") + 1), thinkingLevel: selection.thinkingLevel! }
    : resolveModelRoute(selection.modelTier!, activeModel, (provider, id) => supportedLevels(provider, id) !== undefined);
  const levels = supportedLevels(route.provider, route.id);
  if (!levels) throw new Error(`${route.provider}/${route.id} is unavailable`);
  if (!levels.includes(route.thinkingLevel)) throw new Error(`${route.provider}/${route.id} does not support thinkingLevel ${route.thinkingLevel}; supported: ${levels.join(", ")}`);
  return route;
}
