export type FileStatus = "added" | "modified" | "deleted";
export type ReviewApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingChangeResult {
  turnIndex: number;
  path: string;
  fileStatus: FileStatus;
  status: ReviewApprovalStatus;
  timestamp: number;
  oldContent: string | null;
  newContent: string | null;
  unifiedDiff?: string;
  addedLines?: number;
  deletedLines?: number;
}

export interface ApprovalResult {
  turnIndex: number;
  path: string;
  status: ReviewApprovalStatus;
  timestamp: number;
  snapshotEntryId?: string;
  snapshotTreeHash?: string;
}

export interface ChangeReviewMethods {
  "change-review.pending": {
    params: { sessionId: string; sessionPath?: string };
    result: PendingChangeResult[];
  };
  "change-review.approvals": {
    params: { sessionId: string; sessionPath?: string; status?: ReviewApprovalStatus };
    result: ApprovalResult[];
  };
  "change-review.approve": {
    params: { sessionId: string; path: string };
    result: { ok: boolean; snapshotEntryId?: string; error?: string };
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
