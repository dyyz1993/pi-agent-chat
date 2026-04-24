export interface SessionMethods {
  "session.getEntries": {
    params: { sessionPath: string; limit?: number; cursor?: string };
    result: { entries: SessionEntry[]; hasMore: boolean };
  };
}

export interface SessionEntry {
  id: string;
  type: "message" | "model_change" | "thinking_level_change" | "session_info" | "compaction" | "custom" | "label" | "deletion";
  parentId: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}
