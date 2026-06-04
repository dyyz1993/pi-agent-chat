export type FileStatus = "added" | "modified" | "deleted";

export interface PendingChangeResult {
  turnIndex: number;
  path: string;
  fileStatus: FileStatus;
  status: "pending" | "approved" | "rejected";
  timestamp: number;
  oldContent: string | null;
  newContent: string | null;
}

export interface ChangeReviewMethods {
  "change-review.pending": {
    params: { sessionId: string; sessionPath?: string };
    result: PendingChangeResult[];
  };
  "change-review.approve": {
    params: { sessionId: string; path: string };
    result: { ok: boolean };
  };
  "change-review.reject": {
    params: { sessionId: string; path: string };
    result: { ok: boolean; rolledBack?: boolean; error?: string };
  };
  "change-review.approveAll": {
    params: { sessionId: string };
    result: { count: number };
  };
  "change-review.rejectAll": {
    params: { sessionId: string };
    result: { count: number; rolledBack: number };
  };
}
