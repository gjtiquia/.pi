import { validateModelSelection, type ModelSelection, type ThinkingLevel } from "../../preferences/model-tiers.ts";

export interface SavedModelSelection {
  modelTier?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
}

// Resume is a lifecycle concern: pin the original resolved model rather than
// re-routing its tier after policy changes. Never substitute the parent's state.
export function selectionForResume(request: ModelSelection, saved: SavedModelSelection | undefined): ModelSelection {
  validateModelSelection(request);
  if (!saved?.modelProvider || !saved.modelId || !saved.thinkingLevel) {
    throw new Error("Cannot resume: child metadata lacks explicit model/thinking settings. Start a new child with an explicit selection.");
  }
  const model = `${saved.modelProvider}/${saved.modelId}`;
  const sameModelChoice = request.model === model || (saved.modelTier !== undefined && request.modelTier === saved.modelTier);
  if (!sameModelChoice || request.thinkingLevel !== saved.thinkingLevel) {
    throw new Error(`Resume must preserve the child's model (${model}${saved.modelTier ? `; tier ${saved.modelTier}` : ""}) and thinkingLevel (${saved.thinkingLevel})`);
  }
  return { model, thinkingLevel: saved.thinkingLevel };
}
