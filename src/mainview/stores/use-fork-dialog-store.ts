import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("fork-dialog");

export interface ForkDialogConfig {
  sessionId: string;
  entryId: string;
  /** Where the fork was initiated from (for analytics/logging) */
  source: "messageCard" | "chatPanel" | "timelineTurn";
}

interface ForkDialogState {
  open: boolean;
  config: ForkDialogConfig | null;
  forking: boolean;
  openDialog: (config: ForkDialogConfig) => void;
  closeDialog: () => void;
  setForking: (forking: boolean) => void;
}

export const useForkDialogStore = create<ForkDialogState>()((set) => ({
  open: false,
  config: null,
  forking: false,

  openDialog: (config) => {
    log.info("fork dialog opened", { source: config.source, sessionId: config.sessionId });
    set({ open: true, config, forking: false });
  },

  closeDialog: () => {
    set({ open: false, config: null, forking: false });
  },

  setForking: (forking) => {
    set({ forking });
  },
}));
