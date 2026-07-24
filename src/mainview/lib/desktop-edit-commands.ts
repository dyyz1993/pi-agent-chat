import { copyToClipboard } from "../utils/clipboard";
import { useAttachmentStore } from "../stores/use-attachment-store";
import { apiClient } from "./api-client";

export type DesktopEditCommand = "copy" | "cut" | "paste" | "selectAll" | "undo" | "redo";

interface DesktopEditCommandPayload {
  text?: string;
  imageBase64?: string;
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;

let isDesktopShortcutListenerInstalled = false;

export function replaceTextRange(
  value: string,
  start: number,
  end: number,
  insertText: string,
): { value: string; caret: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const nextValue = `${value.slice(0, safeStart)}${insertText}${value.slice(safeEnd)}`;
  return { value: nextValue, caret: safeStart + insertText.length };
}

function isTextControl(element: Element | null): element is TextControl {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
}

function isWritableTextControl(element: TextControl): boolean {
  return !element.disabled && !element.readOnly;
}

function getSelectedTextFromControl(element: TextControl): string {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  if (end <= start) return "";
  return element.value.slice(start, end);
}

function setNativeControlValue(element: TextControl, value: string): void {
  const prototype = Object.getPrototypeOf(element) as TextControl;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function replaceControlSelection(element: TextControl, insertText: string): void {
  if (!isWritableTextControl(element)) return;
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const next = replaceTextRange(element.value, start, end, insertText);
  setNativeControlValue(element, next.value);
  element.focus();
  element.setSelectionRange(next.caret, next.caret);
}

function readCurrentSelectionText(): string {
  const active = document.activeElement;
  if (isTextControl(active)) {
    const text = getSelectedTextFromControl(active);
    if (text) return text;
  }
  return window.getSelection()?.toString() ?? "";
}

async function handleCopy(): Promise<boolean> {
  const text = readCurrentSelectionText();
  if (!text) return false;
  return copyToClipboard(text);
}

async function handleCut(): Promise<boolean> {
  const active = document.activeElement;
  if (isTextControl(active)) {
    const text = getSelectedTextFromControl(active);
    if (!text) return false;
    const ok = await copyToClipboard(text);
    if (ok) replaceControlSelection(active, "");
    return ok;
  }
  return document.execCommand("cut");
}

function handlePaste(text: string): boolean {
  const active = document.activeElement;
  if (isTextControl(active)) {
    replaceControlSelection(active, text);
    return true;
  }
  return document.execCommand("insertText", false, text);
}

function base64ToFile(base64: string, name: string, type: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, { type });
}

function handlePasteImage(imageBase64: string): boolean {
  if (!imageBase64) return false;
  const file = base64ToFile(imageBase64, "clipboard-image.png", "image/png");
  useAttachmentStore.getState().addFiles([file]);
  return true;
}

function handleSelectAll(): boolean {
  const active = document.activeElement;
  if (isTextControl(active)) {
    active.focus();
    active.select();
    return true;
  }
  return document.execCommand("selectAll");
}

async function readNativeClipboardText(): Promise<string> {
  try {
    const result = await apiClient.call("system.readClipboard", {});
    return result.text ?? "";
  } catch {
    return "";
  }
}

async function readNativeClipboardImage(): Promise<string> {
  try {
    const result = await apiClient.call("system.readClipboardImage", {});
    return result.pngBase64 ?? "";
  } catch {
    return "";
  }
}

function getEditCommandFromKeyboardEvent(event: KeyboardEvent): DesktopEditCommand | null {
  if (!event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "a") return "selectAll";
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "v") return "paste";
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return null;
}

function installDesktopShortcutFallback(): void {
  if (isDesktopShortcutListenerInstalled) return;
  isDesktopShortcutListenerInstalled = true;
  document.addEventListener(
    "keydown",
    (event) => {
      const command = getEditCommandFromKeyboardEvent(event);
      if (!command) return;
      const active = document.activeElement;
      if (isTextControl(active) && command !== "paste") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        if (command === "paste") {
          const imageBase64 = await readNativeClipboardImage();
          if (imageBase64) {
            await window.__piAgentDesktopEditCommand?.("paste", { imageBase64 });
            return;
          }
          const text = await readNativeClipboardText();
          await window.__piAgentDesktopEditCommand?.("paste", { text });
          return;
        }
        await window.__piAgentDesktopEditCommand?.(command);
      })();
    },
    true,
  );
}

export function installDesktopEditCommandBridge(): void {
  window.__piAgentDesktopEditCommand = async (
    command: DesktopEditCommand,
    payload?: DesktopEditCommandPayload,
  ) => {
    switch (command) {
      case "copy":
        return handleCopy();
      case "cut":
        return handleCut();
      case "paste":
        if (payload?.imageBase64) return handlePasteImage(payload.imageBase64);
        return handlePaste(payload?.text ?? "");
      case "selectAll":
        return handleSelectAll();
      case "undo":
        return document.execCommand("undo");
      case "redo":
        return document.execCommand("redo");
      default:
        return false;
    }
  };
  installDesktopShortcutFallback();
}
