/**
 * Shared zoom utilities for file/code viewers (FileOverlay, DiffOverlay, etc.).
 * All consumers share the same localStorage key so a user's zoom preference
 * is consistent across viewers.
 */

export const ZOOM_STORAGE_KEY = "pi-file-editor-zoom";
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 28;
export const ZOOM_DEFAULT = 12;
export const ZOOM_STEP = 2;

/** Default font size for diff viewers (desktop). Mobile uses ZOOM_DEFAULT. */
export const ZOOM_DEFAULT_DIFF_DESKTOP = 13;

export function clampZoom(value: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

export function loadSavedZoom(): number {
  try {
    const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!isNaN(n) && n >= ZOOM_MIN && n <= ZOOM_MAX) return n;
    }
  } catch {
    // localStorage may be unavailable
  }
  return ZOOM_DEFAULT;
}

export function saveZoom(zoom: number): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // ignore
  }
}
