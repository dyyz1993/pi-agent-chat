/**
 * Manages the AbortController lifecycle for quick-create auto-start.
 *
 * Each call aborts the previous controller (if any) and registers a fresh
 * one. This lets App.tsx cancel an in-flight quick-start when the user
 * triggers a new project, switches tabs, or closes the project.
 */
export function abortPreviousAndTrack(
  ref: { current: AbortController | null },
): AbortController {
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}
