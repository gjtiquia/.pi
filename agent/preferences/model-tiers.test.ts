import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_TIER_VALUES, THINKING_LEVEL_VALUES, validateModelSelection,
  resolveModelSelection, type ModelSelection,
} from "./model-tiers.ts";

const active = { provider: "openai-codex", id: "parent" };
const supported = () => THINKING_LEVEL_VALUES;

test("both model choice and thinking are mandatory; inherit is not a tier", () => {
  assert.deepEqual(MODEL_TIER_VALUES, ["fast", "balanced", "deep"]);
  for (const selection of [
    {}, { thinkingLevel: "low" },
    { modelTier: "fast" }, { model: "provider/model" },
    { model: "provider/model", modelTier: "fast", thinkingLevel: "low" },
    { modelTier: "inherit", thinkingLevel: "low" },
    { modelTier: "fast", thinkingLevel: "ultra" },
    { model: "provider/", thinkingLevel: "low" },
    { model: "/model", thinkingLevel: "low" },
    { model: "provider/model with space", thinkingLevel: "low" },
    { model: "", thinkingLevel: "low" },
    { model: null, thinkingLevel: "low" },
  ]) assert.throws(() => validateModelSelection(selection));
  assert.doesNotThrow(() => validateModelSelection({ modelTier: "fast", thinkingLevel: "max" }));
  assert.doesNotThrow(() => validateModelSelection({ model: "other/vendor/model", thinkingLevel: "off" }));
});

test("tiers stay within their provider; balanced uses Sol 6.1", () => {
  assert.deepEqual(resolveModelSelection({ modelTier: "fast", thinkingLevel: "max" }, active, supported),
    { provider: "openai-codex", id: "gpt-6-luna", thinkingLevel: "max" });
  assert.equal(resolveModelSelection({ modelTier: "balanced", thinkingLevel: "high" }, active, supported).id, "gpt-6.1-sol");
  assert.deepEqual(resolveModelSelection({ modelTier: "deep", thinkingLevel: "medium" }, { provider: "opencode-go", id: "parent" }, supported),
    { provider: "opencode-go", id: "kimi-k3", thinkingLevel: "medium" });
});

test("an explicit model crosses providers and does not require an active model", () => {
  assert.deepEqual(resolveModelSelection({ model: "other/vendor/model", thinkingLevel: "low" }, undefined, supported),
    { provider: "other", id: "vendor/model", thinkingLevel: "low" });
});

test("missing routes, unavailable models, and unsupported thinking never fall back", () => {
  assert.throws(() => resolveModelSelection({ modelTier: "fast", thinkingLevel: "low" }, undefined, supported), /No active provider/);
  assert.throws(() => resolveModelSelection({ modelTier: "fast", thinkingLevel: "low" }, { provider: "other", id: "parent" }, supported), /No fast route/);
  assert.throws(() => resolveModelSelection({ modelTier: "deep", thinkingLevel: "high" }, active, () => undefined), /is unavailable/);
  assert.throws(() => resolveModelSelection({ model: "other/model", thinkingLevel: "high" }, active, () => undefined), /is unavailable/);
  assert.throws(() => resolveModelSelection({ modelTier: "fast", thinkingLevel: "max" }, active, () => ["off", "low", "high", "xhigh"]), /does not support thinkingLevel max/);
  assert.throws(() => resolveModelSelection({ modelTier: "deep", thinkingLevel: "off" }, active, () => ["low", "medium", "high"]), /does not support thinkingLevel off/);
  assert.throws(() => resolveModelSelection({ modelTier: "inherit", thinkingLevel: "high" } as unknown as ModelSelection, active, supported), /Unknown model tier/);
});
