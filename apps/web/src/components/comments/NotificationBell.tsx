import React, { useEffect, useRef, useState } from 'react';
import { useNotificationStore } from '../../stores/notificationStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { navigate, projectPath } from '../../routing';
import type { NotificationData } from '../../services/api';
import { relativeTime } from './commentUtils';

const POLL_MS = 30_000;

/** @mentions and replies, with an unread badge. Polls, and refreshes on focus. */
export default function NotificationBell() {
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => void useNotificationStore.getState().load();
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openNotification = (n: NotificationData) => {
    setOpen(false);
    void useNotificationStore.getState().markRead([n.id]);
    if (useCommentsStore.getState().projectId === n.projectId) {
      void useCommentsStore.getState().goToThread(n.threadId);
    } else {
      navigate(`${projectPath(n.projectId, n.diagramId)}?thread=${encodeURIComponent(n.threadId)}`);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="relative rounded px-1.5 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notification-bell"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
            data-testid="notification-count"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
          role="menu"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold text-gray-700">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => void useNotificationStore.getState().markRead()}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-gray-400">
                You&apos;re all caught up.
              </li>
            )}
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="notification-item"
                  className={`w-full border-b px-3 py-2 text-left hover:bg-gray-50 ${n.readAt ? '' : 'bg-blue-50/60'}`}
                  onClick={() => openNotification(n)}
                >
                  <div className="text-xs text-gray-700">
                    <span className="font-semibold">{n.actor.name}</span>{' '}
                    {n.type === 'mention' ? 'mentioned you' : 'replied'} in{' '}
                    <span className="font-medium">{n.diagramTitle}</span>
                    <span className="text-gray-400"> · {n.projectName}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.excerpt}</p>
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {relativeTime(n.createdAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
