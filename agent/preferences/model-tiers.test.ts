import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_TIER_VALUES, THINKING_LEVEL_VALUES, MODEL_SELECTION_GUIDANCE, MODEL_SELECTION_DESCRIPTION, validateModelSelection,
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

test("Codex presets bundle Luna medium, Luna high, and Sol high", () => {
  for (const [modelTier, id, thinkingLevel] of [
    ["fast", "gpt-6-luna", "medium"],
    ["balanced", "gpt-6-luna", "high"],
    ["deep", "gpt-6.1-sol", "high"],
  ] as const) {
    assert.deepEqual(resolveModelSelection({ modelTier }, active, supported),
      { provider: "openai-codex", id, thinkingLevel });
  }
});

test("other provider presets retain their model routes with medium thinking", () => {
  for (const [modelTier, id] of [
    ["fast", "deepseek-v4.1-flash"], ["balanced", "glm-5.3-flash"], ["deep", "kimi-k3"],
  ] as const) {
    assert.deepEqual(resolveModelSelection({ modelTier }, { provider: "opencode-go", id: "parent" }, supported),
      { provider: "opencode-go", id, thinkingLevel: "medium" });
  }
});

test("an explicit model crosses providers and does not require an active model", () => {
  assert.deepEqual(resolveModelSelection({ model: "other/vendor/model", thinkingLevel: "low" }, undefined, supported),
    { provider: "other", id: "vendor/model", thinkingLevel: "low" });
  assert.deepEqual(resolveModelSelection({ model: "openai-codex/gpt-6-astra", thinkingLevel: "medium" }, undefined, supported),
    { provider: "openai-codex", id: "gpt-6-astra", thinkingLevel: "medium" });
});

test("missing routes, unavailable models, and unsupported thinking never fall back", () => {
  assert.throws(() => resolveModelSelection({ modelTier: "fast" }, undefined, supported), /No active provider/);
  assert.throws(() => resolveModelSelection({ modelTier: "fast" }, { provider: "other", id: "parent" }, supported), /No fast route/);
  assert.throws(() => resolveModelSelection({ modelTier: "deep" }, active, () => undefined), /is unavailable/);
  assert.throws(() => resolveModelSelection({ model: "other/model", thinkingLevel: "high" }, active, () => undefined), /is unavailable/);
  assert.throws(() => resolveModelSelection({ modelTier: "balanced" }, active, () => ["off", "low", "medium", "xhigh"]), /does not support thinkingLevel high/);
  assert.throws(() => resolveModelSelection({ modelTier: "fast" }, active, () => ["low", "high"]), /does not support thinkingLevel medium/);
  assert.throws(() => resolveModelSelection({ model: "other/model", thinkingLevel: "off" }, active, () => ["medium"]), /does not support thinkingLevel off/);
  assert.throws(() => resolveModelSelection({ modelTier: "inherit" } as unknown as ModelSelection, active, supported), /Unknown model tier/);
});
