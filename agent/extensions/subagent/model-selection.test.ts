import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModelSelection } from "../../preferences/model-tiers.ts";
import { selectionForResume } from "./model-selection.ts";

const saved = { modelTier: "balanced", modelProvider: "openai-codex", modelId: "gpt-6-sol", thinkingLevel: "high" as const };

test("resuming pins original model/thinking despite changed tier presets and parent state", () => {
  const selection = selectionForResume({ modelTier: "balanced" }, saved);
  assert.deepEqual(selection, { model: "openai-codex/gpt-6-sol", thinkingLevel: "high" });
  const resolved = resolveModelSelection(selection, { provider: "opencode-go", id: "parent" }, () => ["high"]);
  assert.deepEqual(resolved, { provider: "openai-codex", id: "gpt-6-sol", thinkingLevel: "high" });
});

test("resuming can explicitly name the saved model instead of its original tier", () => {
  assert.deepEqual(selectionForResume({ model: "openai-codex/gpt-6-sol", thinkingLevel: "high" }, saved),
    { model: "openai-codex/gpt-6-sol", thinkingLevel: "high" });
  assert.deepEqual(selectionForResume({ model: "other/model", thinkingLevel: "off" },
    { modelProvider: "other", modelId: "model", thinkingLevel: "off" }),
    { model: "other/model", thinkingLevel: "off" });
});

test("resuming rejects changed thinking, model, tier, and incomplete legacy metadata", () => {
  assert.throws(() => selectionForResume({ model: "openai-codex/gpt-6-sol", thinkingLevel: "max" }, saved), /must preserve/);
  assert.throws(() => selectionForResume({ modelTier: "fast" }, saved), /must preserve/);
  assert.throws(() => selectionForResume({ model: "other/model", thinkingLevel: "high" }, saved), /must preserve/);
  assert.throws(() => selectionForResume({ modelTier: "balanced" }, undefined), /metadata lacks/);
  assert.throws(() => selectionForResume({ modelTier: "balanced" }, { ...saved, thinkingLevel: undefined }), /metadata lacks/);
  assert.throws(() => selectionForResume({ modelTier: "balanced", thinkingLevel: "high" }, saved), /bundles thinkingLevel/);
  assert.throws(() => selectionForResume({ modelTier: "balanced" }, { modelProvider: "other", modelId: "model", thinkingLevel: "off" }), /must preserve/);
});

test("a saved model that is now unavailable fails rather than re-routing the tier", () => {
  const selection = selectionForResume({ modelTier: "balanced" }, saved);
  assert.throws(() => resolveModelSelection(selection, { provider: "openai-codex", id: "gpt-6.1-sol" }, () => undefined), /gpt-6-sol is unavailable/);
});
