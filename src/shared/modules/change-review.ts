export interface PendingChangeResult {
  turnIndex: number;
  path: string;
  status: "pending" | "approved" | "rejected";
  diff: string | null;
  timestamp: number;
}

export interface ChangeReviewMethods {
  "change-review.pending": {
    params: { sessionId: string };
    result: PendingChangeResult[];
  };
  "change-review.approve": {
    params: { sessionId: string; turnIndex: number; path: string };
    result: { ok: boolean };
  };
  "change-review.reject": {
    params: { sessionId: string; turnIndex: number; path: string };
    result: { ok: boolean };
  };
  "change-review.approveAll": {
    params: { sessionId: string };
    result: { count: number };
  };
}
