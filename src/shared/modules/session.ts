export interface SessionMethods {
  "session.getMetadata": {
    params: {};
    result: {
      sessionId: string;
      sessionPath: string;
      projectPath: string;
      cwd: string;
      delegateParentSessionId?: string;
      createdAt?: string;
    };
  };
  "session.getEntries": {
    params: { sessionPath: string; limit?: number; cursor?: string };
    result: { entries: SessionEntry[]; hasMore: boolean };
  };
  "session.create": {
    params: { projectPath: string };
    result: { sessionId: string; sessionPath: string };
  };
  "session.rename": {
    params: { sessionId: string; sessionPath: string; newName: string };
    result: { ok: boolean };
  };
  "session.delete": {
    params: { sessionId: string; sessionPath: string };
    result: { ok: boolean };
  };
  "session.pin": {
    params: { sessionId: string };
    result: { pinnedSessionIds: string[] };
  };
  "session.unpin": {
    params: { sessionId: string };
    result: { pinnedSessionIds: string[] };
  };
  "session.listPinned": {
    params: {};
    result: { pinnedSessionIds: string[] };
  };
  "session.updateCwd": {
    params: { sessionPath: string; newCwd: string };
    result: { ok: boolean };
  };
  "session.saveTierConfig": {
    params: {
      sessionPath: string;
      tierModels: Record<string, string>;
      currentTier: string | null;
      currentModel: { provider: string; id: string } | null;
    };
    result: { ok: boolean };
  };
  "session.loadTierConfig": {
    params: { sessionPath: string };
    result: {
      config: {
        tierModels: Record<string, string>;
        currentTier: string | null;
        currentModel: { provider: string; id: string } | null;
      } | null;
    };
  };
}

export interface SessionEntry {
  id: string;
  type:
    | "message"
    | "model_change"
    | "thinking_level_change"
    | "session_info"
    | "compaction"
    | "custom"
    | "label"
    | "deletion"
    | "branch_summary"
    | "custom_message"
    | "segment_summary"
    | "session";
  parentId: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}
