const VIEWPORT_HEIGHT_VAR = "--app-viewport-height";
const VIEWPORT_WIDTH_VAR = "--app-viewport-width";

export interface ViewportSize {
  width: number;
  height: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function getCurrentViewportSize(win: Window = window): ViewportSize {
  const visualViewport = win.visualViewport;
  const width = visualViewport?.width ?? win.innerWidth;
  const height = visualViewport?.height ?? win.innerHeight;
  return { width, height };
}

export function syncViewportCssVars(
  size: ViewportSize,
  root: HTMLElement = document.documentElement,
): void {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return;
  root.style.setProperty(VIEWPORT_WIDTH_VAR, `${width}px`);
  root.style.setProperty(VIEWPORT_HEIGHT_VAR, `${height}px`);
}

export function installViewportCssVarSync(win: Window = window): () => void {
  let frameId: number | null = null;

  const syncNow = () => {
    syncViewportCssVars(getCurrentViewportSize(win), win.document.documentElement);
  };

  const sync = () => {
    if (frameId !== null) win.cancelAnimationFrame(frameId);
    frameId = win.requestAnimationFrame(() => {
      frameId = null;
      syncNow();
    });
  };

  syncNow();
  win.addEventListener("resize", sync);
  win.visualViewport?.addEventListener("resize", sync);

  return () => {
    if (frameId !== null) win.cancelAnimationFrame(frameId);
    win.removeEventListener("resize", sync);
    win.visualViewport?.removeEventListener("resize", sync);
  };
}
