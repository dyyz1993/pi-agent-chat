import { lazy } from "react";

const RELOAD_FLAG = "__lazyReloadAt";
const RELOAD_COOLDOWN_MS = 10_000;

function shouldReloadForChunkFailure(): boolean {
  try {
    const last = sessionStorage.getItem(RELOAD_FLAG);
    if (!last) return true;
    const ts = Number.parseInt(last, 10);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage may be unavailable in some embedded contexts.
  }
}

export function clearLazyReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // sessionStorage may be unavailable in some embedded contexts.
  }
}

export function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    message.includes("error loading dynamically imported module")
  );
}

export function maybeReloadForChunkError(err: unknown, reload = () => window.location.reload()) {
  if (!isChunkLoadError(err) || !shouldReloadForChunkFailure()) return false;
  markReload();
  if (typeof window !== "undefined") {
    reload();
  }
  return true;
}

export const safeLazy: typeof lazy = (factory) => {
  const wrappedFactory = async () => {
    try {
      return await factory();
    } catch (err) {
      maybeReloadForChunkError(err);
      throw err;
    }
  };
  return lazy(wrappedFactory);
};
