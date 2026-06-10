const INPUT_DRAFT_KEY = "pi-input-draft";

export function readDraft(sessionId: string): string {
  try {
    return localStorage.getItem(`${INPUT_DRAFT_KEY}:${sessionId}`) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(sessionId: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(`${INPUT_DRAFT_KEY}:${sessionId}`, text);
    } else {
      localStorage.removeItem(`${INPUT_DRAFT_KEY}:${sessionId}`);
    }
  } catch {
    /* ignore quota */
  }
}
