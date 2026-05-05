import type { SnapshotInfo } from "../../mainview/types";

export interface SnapshotMethods {
  "snapshot.list": {
    params: { sessionId: string };
    result: SnapshotInfo[];
  };
  "snapshot.get": {
    params: { sessionId: string; snapshotId: string };
    result: SnapshotInfo | null;
  };
  "snapshot.rollback": {
    params: {
      sessionId: string;
      snapshotId: string;
      files?: string[];
    };
    result: { ok: boolean; restoredFiles: string[]; error?: string };
  };
  "snapshot.unrevert": {
    params: { sessionId: string; snapshotId: string };
    result: { ok: boolean; error?: string };
  };
  "snapshot.navigate_tree": {
    params: { sessionId: string; snapshotId?: string; path?: string };
    result: {
      entries: Array<{
        name: string;
        path: string;
        type: "file" | "directory";
        contentHash?: string;
      }>;
      currentPath: string;
    };
  };
  "snapshot.get_tree": {
    params: { sessionId: string; snapshotId: string; filePath: string };
    result: {
      path: string;
      content: string;
      contentHash: string;
    } | null;
  };
}
