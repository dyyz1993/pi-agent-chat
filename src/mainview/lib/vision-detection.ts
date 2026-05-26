/**
 * Vision capability detection for AI models.
 *
 * Since the RPC `getAvailableModels` does not currently include `input` capabilities,
 * we use a known set of model name patterns to detect vision support.
 * This can be replaced with proper capability data when the bottom layer is updated.
 */

/** Model ID patterns (lowercase) known to support image input. */
const VISION_MODEL_PATTERNS: string[] = [
  "qwen3.5-plus",
  "qwen3.6-plus",
  "qwen2.5-vl",
  "qwen2-vl",
  "glm-4v",
  "glm-5v",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4-vision",
  "claude-3",
  "claude-4",
  "gemini",
  "gemma",
  "llava",
  "cogvlm",
  "internvl",
  "pixtral",
  "molmo",
];

/**
 * Check if a model supports image/vision input.
 *
 * Checks in order:
 * 1. `input` array from RPC (if available)
 * 2. Known model name patterns
 */
export function isVisionModel(model: { provider: string; id: string; input?: string[] }): boolean {
  // Prefer explicit capability data if available
  if (model.input) {
    return model.input.includes("image");
  }

  const modelId = model.id.toLowerCase();

  // Check known vision model patterns
  for (const pattern of VISION_MODEL_PATTERNS) {
    if (modelId.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all vision-capable models from the available models list.
 */
export function getVisionModels(
  models: Array<{ provider: string; id: string; input?: string[] }>,
): Array<{ provider: string; id: string; input?: string[] }> {
  return models.filter(isVisionModel);
}
