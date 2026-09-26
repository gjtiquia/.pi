// Canonical model-tier policy shared by the subagent extension and Gateway cron.
// Keep this module free of Pi runtime dependencies so it can be vendored.
export const MODEL_TIERS = {
  "openai-codex": {
    fast: "gpt-6-luna",
    balanced: "gpt-6-sol",
    deep: "gpt-6-astra",
  },
  "opencode-go": {
    fast: "deepseek-v4.1-flash",
    balanced: "glm-5.3-flash",
    deep: "kimi-k3",
  },
} as const;

export const MODEL_TIER_VALUES = ["fast", "balanced", "deep", "inherit"] as const;
export type ModelTier = (typeof MODEL_TIER_VALUES)[number];
export type RoutedModelTier = Exclude<ModelTier, "inherit">;

export function resolveModelRoute(
  modelTier: ModelTier,
  activeModel: { provider: string; id: string } | undefined,
  modelExists: (provider: string, id: string) => boolean,
): { provider?: string; id?: string; fallbackReason?: string } {
  if (!activeModel) return { fallbackReason: "no active model was available" };
  if (modelTier === "inherit") return { provider: activeModel.provider, id: activeModel.id };

  const providerRoutes = MODEL_TIERS[activeModel.provider as keyof typeof MODEL_TIERS];
  const routedId = providerRoutes?.[modelTier];
  if (!routedId) return {
    provider: activeModel.provider,
    id: activeModel.id,
    fallbackReason: `no ${modelTier} route is configured for ${activeModel.provider}`,
  };
  if (!modelExists(activeModel.provider, routedId)) return {
    provider: activeModel.provider,
    id: activeModel.id,
    fallbackReason: `${activeModel.provider}/${routedId} is unavailable`,
  };
  return { provider: activeModel.provider, id: routedId };
}
