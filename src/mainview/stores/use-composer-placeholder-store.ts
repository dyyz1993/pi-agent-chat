import { create } from "zustand";

export type ComposerPlaceholderType = "textQuote" | "sessionRef";

export interface ComposerPlaceholder {
  id: string;
  type: ComposerPlaceholderType;
  text: string;
  title: string;
  description?: string;
  sessionId?: string;
  createdAt: number;
  expanded: boolean;
}

interface ComposerPlaceholderState {
  placeholders: ComposerPlaceholder[];
  addTextQuote: (text: string) => string | null;
  addSessionReference: (session: {
    sessionId: string;
    title: string;
    description?: string;
  }) => string | null;
  removePlaceholder: (id: string) => void;
  togglePlaceholder: (id: string) => void;
  clearPlaceholders: () => void;
}

const MAX_QUOTE_TEXT_LENGTH = 4000;

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

export function serializeComposerPlaceholders(placeholders: ComposerPlaceholder[]): string {
  return placeholders
    .map((placeholder, index) => {
      if (placeholder.type === "sessionRef") {
        const sessionId = placeholder.sessionId?.trim();
        if (!sessionId) return null;
        return `引用会话 ${index + 1}: ${placeholder.title}\n@session:${sessionId}`;
      }
      if (placeholder.type !== "textQuote") return null;
      const text = placeholder.text.trim();
      if (!text) return null;
      const fence = createTextFence(text);
      return `引用 ${index + 1}: ${placeholder.title}\n${fence}text\n${text}\n${fence}`;
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
  addSessionReference: ({ sessionId, title, description }) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return null;
    const id = createId();
    set((state) => ({
      placeholders: [
        ...state.placeholders,
        {
          id,
          type: "sessionRef",
          text: `@session:${normalizedSessionId}`,
          title: compactTitle(title || normalizedSessionId),
          description,
          sessionId: normalizedSessionId,
          createdAt: Date.now(),
          expanded: false,
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
