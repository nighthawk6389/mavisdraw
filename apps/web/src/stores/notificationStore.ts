import { create } from 'zustand';
import {
  apiListNotifications,
  apiMarkNotificationsRead,
  type NotificationData,
} from '../services/api';

interface NotificationState {
  notifications: NotificationData[];
  unreadCount: number;
  load: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
}

/** @mentions and replies to your threads, across all projects. */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  load: async () => {
    try {
      const { notifications, unreadCount } = await apiListNotifications();
      set({ notifications, unreadCount });
    } catch {
      // Offline or signed out: keep what we have
    }
  },

  markRead: async (ids) => {
    const now = new Date().toISOString();
    const target = ids ? new Set(ids) : null;
    // Optimistic: the badge clears immediately
    set((s) => {
      const notifications = s.notifications.map((n) =>
        !n.readAt && (!target || target.has(n.id)) ? { ...n, readAt: now } : n,
      );
      return { notifications, unreadCount: notifications.filter((n) => !n.readAt).length };
    });
    try {
      await apiMarkNotificationsRead(ids);
    } catch {
      await get().load();
    }
  },
}));
