import { create } from "zustand";

export interface ModifiedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  turnIndex: number;
  entryId: string;
  details?: string;
  oldContent?: string | null;
  newContent?: string | null;
  addedLines?: number;
  removedLines?: number;
}

export interface RollbackPreview {
  restored: string[];
  deleted: string[];
  files: ModifiedFile[];
  summary: { totalFiles: number; added: number; modified: number; deleted: number };
}

interface RollbackTarget {
  targetId: string;
  mode: "message" | "withFiles";
  /** 回滚目标用户消息文本；确认回滚成功后填入输入框 */
  userText?: string;
}

interface RollbackOverlayState {
  open: boolean;
  target: RollbackTarget | null;
  preview: RollbackPreview | null;
  loading: boolean;
  selectedFilePath: string | null;

  openRollback: (target: RollbackTarget, preview: RollbackPreview) => void;
  closeRollback: () => void;
  setLoading: (loading: boolean) => void;
  setSelectedFilePath: (path: string | null) => void;
}

export const useRollbackStore = create<RollbackOverlayState>()((set) => ({
  open: false,
  target: null,
  preview: null,
  loading: false,
  selectedFilePath: null,

  openRollback: (target, preview) =>
    set({ open: true, target, preview, loading: false, selectedFilePath: null }),

  closeRollback: () =>
    set({ open: false, target: null, preview: null, loading: false, selectedFilePath: null }),

  setLoading: (loading) => set({ loading }),

  setSelectedFilePath: (selectedFilePath) => set({ selectedFilePath }),
}));
