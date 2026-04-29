import { create } from "zustand";

export type NotificationLevel = "info" | "warning" | "error";

export interface AppNotification {
  id: string;
  message: string;
  level: NotificationLevel;
  timestamp: number;
  sessionId?: string;
  read: boolean;
}

interface NotificationState {
  notifications: AppNotification[];
  panelOpen: boolean;

  push: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  panelOpen: false,

  push(n) {
    const entry: AppNotification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      read: false,
    };
    set((s) => ({
      notifications: [entry, ...s.notifications],
    }));

    if (n.level === "info") {
      setTimeout(() => {
        set((s) => ({
          notifications: s.notifications.filter((x) => x.id !== entry.id),
        }));
      }, 5000);
    }
  },

  markRead(id) {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllRead() {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  dismiss(id) {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll() {
    set({ notifications: [] });
  },

  togglePanel() {
    set((s) => ({ panelOpen: !s.panelOpen }));
  },

  setPanelOpen(open) {
    set({ panelOpen: open });
  },
}));
