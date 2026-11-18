import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_TIERS, MODEL_TIER_VALUES, THINKING_LEVEL_VALUES, MODEL_SELECTION_GUIDANCE, MODEL_SELECTION_DESCRIPTION, validateModelSelection,
  resolveModelSelection, type ModelSelection,
} from "./model-tiers.ts";

const active = { provider: "openai-codex", id: "parent" };
const supported = () => THINKING_LEVEL_VALUES;

test("choose a tier alone or an explicit model plus thinking", () => {
  assert.deepEqual(MODEL_TIER_VALUES, ["fast", "balanced", "deep"]);
  for (const selection of [
    {}, { thinkingLevel: "low" }, { model: "provider/model" },
    { model: "provider/model", modelTier: "fast", thinkingLevel: "low" },
    { modelTier: "inherit" },
    { modelTier: "fast", thinkingLevel: "medium" },
    { modelTier: "balanced", thinkingLevel: "max" },
    { modelTier: "deep", thinkingLevel: "ultra" },
    { model: "provider/model", thinkingLevel: "ultra" },
    { model: "provider/", thinkingLevel: "low" },
    { model: "/model", thinkingLevel: "low" },
    { model: "provider/model with space", thinkingLevel: "low" },
    { model: "", thinkingLevel: "low" },
    { model: null, thinkingLevel: "low" },
  ]) assert.throws(() => validateModelSelection(selection));
  for (const modelTier of MODEL_TIER_VALUES) assert.doesNotThrow(() => validateModelSelection({ modelTier }));
  assert.doesNotThrow(() => validateModelSelection({ model: "other/vendor/model", thinkingLevel: "off" }));
});

test("shared guidance defaults substantive reviews to deep, not mechanical checks", () => {
  const reviewGuidance = MODEL_SELECTION_GUIDANCE.find((guidance) => guidance.startsWith("Default to deep for substantive reviews"));
  assert.ok(reviewGuidance);
  assert.match(reviewGuidance, /both Standards and Spec axes/);
  assert.match(reviewGuidance, /narrow review scope does not justify a cheaper tier/);
  assert.match(reviewGuidance, /deterministic|Mechanical/);
  assert.match(reviewGuidance, /explicit user-requested model or tier override/);
  assert.ok(MODEL_SELECTION_DESCRIPTION.includes(reviewGuidance));
});

test("each tier selects its configured model and thinking within the active provider", () => {
  for (const [provider, presets] of Object.entries(MODEL_TIERS)) {
    for (const modelTier of MODEL_TIER_VALUES) {
      const { id, thinkingLevel } = presets[modelTier];
      assert.doesNotThrow(() => validateModelSelection({ model: `${provider}/${id}`, thinkingLevel }));
      const supportedByPreset = (candidateProvider: string, candidateId: string) =>
        candidateProvider === provider && candidateId === id ? [thinkingLevel] : undefined;
      assert.deepEqual(resolveModelSelection({ modelTier }, { provider, id: "parent" }, supportedByPreset),
        { provider, id, thinkingLevel });
    }
  }
});

test("an explicit model crosses providers and does not require an active model", () => {
  assert.deepEqual(resolveModelSelection({ model: "other/vendor/model", thinkingLevel: "low" }, undefined, supported),
    { provider: "other", id: "vendor/model", thinkingLevel: "low" });
});

test("missing routes, unavailable models, and unsupported thinking never fall back", () => {
  assert.throws(() => resolveModelSelection({ modelTier: "fast" }, undefined, supported), /No active provider/);
  assert.throws(() => resolveModelSelection({ modelTier: "fast" }, { provider: "other", id: "parent" }, supported), /No fast route/);
  assert.throws(() => resolveModelSelection({ modelTier: "deep" }, active, () => undefined), /is unavailable/);
  assert.throws(() => resolveModelSelection({ model: "other/model", thinkingLevel: "high" }, active, () => undefined), /is unavailable/);
  const { id, thinkingLevel } = MODEL_TIERS["openai-codex"].balanced;
  const otherLevels = THINKING_LEVEL_VALUES.filter((level) => level !== thinkingLevel);
  assert.throws(() => resolveModelSelection({ modelTier: "balanced" }, active, () => otherLevels),
    { message: `openai-codex/${id} does not support thinkingLevel ${thinkingLevel}; supported: ${otherLevels.join(", ")}` });
  assert.throws(() => resolveModelSelection({ model: "other/model", thinkingLevel: "off" }, active, () => ["medium"]), /does not support thinkingLevel off/);
  assert.throws(() => resolveModelSelection({ modelTier: "inherit" } as unknown as ModelSelection, active, supported), /Unknown model tier/);
});
