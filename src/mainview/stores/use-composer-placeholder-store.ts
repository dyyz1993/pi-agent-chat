import { create } from "zustand";

interface ComposerPlaceholderBase {
  id: string;
  text: string;
  title: string;
  createdAt: number;
  expanded: boolean;
}

export interface TextQuotePlaceholder extends ComposerPlaceholderBase {
  type: "textQuote";
}

export interface LongContentPlaceholder extends ComposerPlaceholderBase {
  type: "longContent";
  originalLength: number;
  lineCount: number;
  path: string;
}

export type ComposerPlaceholder = TextQuotePlaceholder | LongContentPlaceholder;
export type ComposerPlaceholderType = ComposerPlaceholder["type"];

interface ComposerPlaceholderState {
  placeholders: ComposerPlaceholder[];
  addTextQuote: (text: string) => string | null;
  addLongContentPaste: (text: string) => string | null;
  removePlaceholder: (id: string) => void;
  togglePlaceholder: (id: string) => void;
  clearPlaceholders: () => void;
}

const MAX_QUOTE_TEXT_LENGTH = 4000;
const LONG_CONTENT_HEAD_CHARS = 500;
const LONG_CONTENT_TAIL_CHARS = 500;
const LONG_CONTENT_MAX_EDGE_LINES = 20;
const LONG_CONTENT_DIR = "/tmp/pi-agent-chat-pastes";

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function longestBacktickRun(value: string): number {
  return Math.max(2, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function createTextFence(value: string): string {
  return "`".repeat(longestBacktickRun(value) + 1);
}

function compactTitle(text: string): string {
  const firstLine = text.replace(/\s+/g, " ").trim().slice(0, 72);
  return firstLine || "引用文本";
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function lineCount(text: string): number {
  return text ? text.split(/\r\n|\r|\n/u).length : 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function takeHeadLines(lines: string[], charBudget: number): string[] {
  const result: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (result.length >= LONG_CONTENT_MAX_EDGE_LINES) break;
    const nextChars = chars + line.length + 1;
    if (result.length > 0 && nextChars > charBudget) break;
    result.push(line);
    chars = nextChars;
  }
  return result.length > 0 ? result : [lines[0] ?? ""];
}

function takeTailLines(lines: string[], charBudget: number): string[] {
  const result: string[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (result.length >= LONG_CONTENT_MAX_EDGE_LINES) break;
    const line = lines[i] ?? "";
    const nextChars = chars + line.length + 1;
    if (result.length > 0 && nextChars > charBudget) break;
    result.unshift(line);
    chars = nextChars;
  }
  return result.length > 0 ? result : [lines[lines.length - 1] ?? ""];
}

function compactLongContentBody(text: string): string {
  const lines = text.split(/\r\n|\r|\n/u);
  const totalLines = lines.length;
  const headLines = takeHeadLines(lines, LONG_CONTENT_HEAD_CHARS);
  const tailLines = takeTailLines(lines.slice(headLines.length), LONG_CONTENT_TAIL_CHARS);
  const omittedLines = Math.max(0, totalLines - headLines.length - tailLines.length);
  const tailStart = Math.max(headLines.length + 1, totalLines - tailLines.length + 1);

  return [
    `第 1-${headLines.length} 行：`,
    escapeXml(headLines.join("\n")),
    `... 省略中间 ${omittedLines} 行 ...`,
    `第 ${tailStart}-${totalLines} 行：`,
    escapeXml(tailLines.join("\n")),
  ].join("\n");
}

function serializeLongContent(placeholder: LongContentPlaceholder): string {
  return [
    `<long-content path="${escapeXml(placeholder.path)}" originalLength="${placeholder.originalLength}" lineCount="${placeholder.lineCount}" summary="${escapeXml(placeholder.title)}">`,
    compactLongContentBody(placeholder.text),
    "</long-content>",
  ].join("\n");
}

export function serializeComposerPlaceholders(placeholders: ComposerPlaceholder[]): string {
  return placeholders
    .map((placeholder, index) => {
      if (placeholder.type === "longContent") return serializeLongContent(placeholder);
      if (placeholder.type === "textQuote") {
        const text = placeholder.text.trim();
        if (!text) return null;
        const fence = createTextFence(text);
        return `引用 ${index + 1}: ${placeholder.title}\n${fence}text\n${text}\n${fence}`;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

export function composeInputWithPlaceholders(
  inputText: string,
  placeholders: ComposerPlaceholder[],
): string {
  const input = inputText.trim();
  const context = serializeComposerPlaceholders(placeholders);
  if (!context) return input;
  return input ? `${input}\n\n${context}` : context;
}

export async function persistComposerPlaceholders(
  placeholders: ComposerPlaceholder[],
  writeFile: (path: string, content: string) => Promise<unknown>,
): Promise<void> {
  for (const placeholder of placeholders) {
    if (placeholder.type !== "longContent") continue;
    await writeFile(placeholder.path, placeholder.text);
  }
}

export const useComposerPlaceholderStore = create<ComposerPlaceholderState>((set) => ({
  placeholders: [],
  addTextQuote: (rawText) => {
    const text = rawText.trim().slice(0, MAX_QUOTE_TEXT_LENGTH);
    if (!text) return null;
    const id = createId();
    set((state) => ({
      placeholders: [
        ...state.placeholders,
        {
          id,
          type: "textQuote",
          text,
          title: compactTitle(text),
          createdAt: Date.now(),
          expanded: false,
        },
      ],
    }));
    return id;
  },
  addLongContentPaste: (rawText) => {
    const text = rawText.trim();
    if (!text) return null;
    const id = createId();
    const hash = hashString(`${text.length}:${text.slice(0, 2048)}:${text.slice(-2048)}`);
    const title = `pasted-content-${hash}.txt`;
    set((state) => ({
      placeholders: [
        ...state.placeholders,
        {
          id,
          type: "longContent",
          text,
          title,
          createdAt: Date.now(),
          expanded: false,
          originalLength: text.length,
          lineCount: lineCount(text),
          path: `${LONG_CONTENT_DIR}/${title}`,
        },
      ],
    }));
    return id;
  },
  removePlaceholder: (id) =>
    set((state) => ({
      placeholders: state.placeholders.filter((placeholder) => placeholder.id !== id),
    })),
  togglePlaceholder: (id) =>
    set((state) => ({
      placeholders: state.placeholders.map((placeholder) =>
        placeholder.id === id ? { ...placeholder, expanded: !placeholder.expanded } : placeholder,
      ),
    })),
  clearPlaceholders: () => set({ placeholders: [] }),
}));
