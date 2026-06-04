import { createLogger } from "../../shared/lib/logger";

const logger = createLogger("system");

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      logger.warn("Clipboard API write failed", { error: String(e) });
    }
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    return document.execCommand("copy");
  } catch (e) {
    logger.warn("Fallback clipboard copy failed", { error: String(e) });
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
