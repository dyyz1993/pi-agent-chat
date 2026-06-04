/**
 * Vision capability detection for AI models.
 *
 * Uses the `input` field from `getAvailableModels` RPC response,
 * which is populated from the provider's model definition (`Model.input`).
 */

/**
 * Check if a model supports image/vision input.
 *
 * Relies on the `input` field from the RPC response.
 * Falls back to `false` if input is not available.
 */
export function isVisionModel(model: { input?: ("text" | "image")[] }): boolean {
  if (!model.input) return false;
  return model.input.includes("image");
}

/**
 * Get all vision-capable models from the available models list.
 */
export function getVisionModels<T extends { input?: ("text" | "image")[] }>(models: T[]): T[] {
  return models.filter(isVisionModel);
}
