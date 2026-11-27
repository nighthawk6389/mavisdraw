import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useCommentsStore } from '../../stores/commentsStore';
import { usePresentStore } from '../../stores/presentStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useViewportStore } from '../../stores/viewportStore';
import { useAuthStore } from '../../stores/authStore';
import { usePermissionStore } from '../../stores/permissionStore';
import type { CommentData, CommentThreadData, Member } from '../../services/api';
import MentionTextarea from './MentionTextarea';
import {
  anchorAt,
  bodySegments,
  initials,
  mentionsInBody,
  pinPositionsKey,
  readPinPositions,
  relativeTime,
} from './commentUtils';

const POPOVER_WIDTH = 300;

/**
 * Comment pins and threads, drawn over the canvas. Pins sit on the shape
 * they were dropped on and travel with it.
 */
export default function CommentLayer() {
  const threads = useCommentsStore((s) => s.threads);
  const draft = useCommentsStore((s) => s.draft);
  const activeThreadId = useCommentsStore((s) => s.activeThreadId);
  const pendingThreadId = useCommentsStore((s) => s.pendingThreadId);
  const showResolved = useCommentsStore((s) => s.showResolved);
  const diagramId = useDiagramStore((s) => s.activeDiagramId);
  const zoom = useViewportStore((s) => s.zoom);
  const scrollX = useViewportStore((s) => s.scrollX);
  const scrollY = useViewportStore((s) => s.scrollY);
  const presenting = usePresentStore((s) => s.presenting || s.following);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  // Popovers flip to the left near the right edge: track the layer's width
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(
    () =>
      Array.from(threads.values()).filter(
        (t) =>
          t.diagramId === diagramId &&
          t.comments.length > 0 &&
          (showResolved || !t.resolvedAt || t.id === activeThreadId),
      ),
    [threads, diagramId, showResolved, activeThreadId],
  );
  const active = activeThreadId ? threads.get(activeThreadId) : undefined;

  // Only the shapes pins sit on: a drag changes the elements on every frame,
  // and this layer needn't re-render unless one of those moved
  const pinnedTo = useMemo(
    () =>
      Array.from(
        new Set(
          [...visible, ...(active ? [active] : [])]
            .map((t) => t.elementId)
            .filter((id): id is string => !!id),
        ),
      ),
    [visible, active],
  );
  const positionsKey = useElementsStore((s) => pinPositionsKey(s.elements, pinnedTo));
  const positions = useMemo(
    () => readPinPositions(positionsKey, pinnedTo),
    [positionsKey, pinnedTo],
  );

  // Deep links / notifications: open the thread once it's loaded
  useEffect(() => {
    if (pendingThreadId && threads.has(pendingThreadId)) {
      void useCommentsStore.getState().goToThread(pendingThreadId);
    }
  }, [pendingThreadId, threads]);

  // Leaving a diagram closes its popovers
  useEffect(() => {
    const s = useCommentsStore.getState();
    if (s.draft && s.draft.diagramId !== diagramId) s.cancelDraft();
    const active = s.activeThreadId ? s.threads.get(s.activeThreadId) : undefined;
    if (active && active.diagramId !== diagramId) s.openThread(null);
  }, [diagramId]);

  const toScreen = (p: { x: number; y: number }) => ({
    x: p.x * zoom + scrollX,
    y: p.y * zoom + scrollY,
  });

  const popoverLeft = (sx: number) =>
    sx + 20 + POPOVER_WIDTH > width ? Math.max(8, sx - POPOVER_WIDTH - 12) : sx + 20;

  return (
    <div
      ref={wrapperRef}
      className={`pointer-events-none absolute inset-0 z-20 overflow-hidden ${presenting ? 'hidden' : ''}`}
    >
      {visible.map((thread) => {
        const p = toScreen(anchorAt(thread, positions));
        return (
          <CommentPin
            key={thread.id}
            thread={thread}
            x={p.x}
            y={p.y}
            active={thread.id === activeThreadId}
          />
        );
      })}

      {draft && draft.diagramId === diagramId && (
        <DraftComposer
          x={toScreen(draft).x}
          y={toScreen(draft).y}
          left={popoverLeft(toScreen(draft).x)}
        />
      )}

      {active && active.diagramId === diagramId && (
        <ThreadPopover
          thread={active}
          top={toScreen(anchorAt(active, positions)).y - 16}
          left={popoverLeft(toScreen(anchorAt(active, positions)).x)}
        />
      )}
    </div>
  );
}

const CommentPin = memo(function CommentPin({
  thread,
  x,
  y,
  active,
}: {
  thread: CommentThreadData;
  x: number;
  y: number;
  active: boolean;
}) {
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;
  const resolved = !!thread.resolvedAt;
  return (
    <button
      type="button"
      data-testid="comment-pin"
      data-thread-id={thread.id}
      aria-label={`Comment by ${first.author.name}: ${first.body}${replies ? ` (${replies} ${replies === 1 ? 'reply' : 'replies'})` : ''}`}
      className={`pointer-events-auto absolute flex h-7 min-w-7 items-center gap-1 rounded-full rounded-bl-none border-2 px-1 text-[10px] font-semibold shadow-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'scale-110 border-blue-600' : 'border-white'
      } ${resolved ? 'bg-gray-300 text-gray-600' : 'bg-amber-400 text-amber-950'}`}
      style={{ left: x, top: y - 28 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => useCommentsStore.getState().openThread(active ? null : thread.id)}
    >
      <span className="flex h-5 w-5 items-center justify-center">
        {initials(first.author.name)}
      </span>
      {replies > 0 && <span className="pr-1">{replies + 1}</span>}
    </button>
  );
});

function DraftComposer({ x, y, left }: { x: number; y: number; left: number }) {
  const members = useCommentsStore((s) => s.members);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await useCommentsStore
      .getState()
      .submitDraft(body.trim(), mentionsInBody(body, members));
    setBusy(false);
    if (ok) setBody('');
  };

  return (
    <>
      <div
        className="pointer-events-none absolute h-7 w-7 rounded-full rounded-bl-none border-2 border-white bg-blue-500 shadow-md"
        style={{ left: x, top: y - 28 }}
      />
      <div
        role="dialog"
        aria-label="New comment"
        data-testid="comment-composer"
        className="pointer-events-auto absolute rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
        style={{ left, top: y - 16, width: POPOVER_WIDTH }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MentionTextarea
          value={body}
          onChange={setBody}
          members={members}
          autoFocus
          disabled={busy}
          placeholder="Add a comment… (@ to mention)"
          testId="comment-input"
          onSubmit={submit}
          onCancel={() => useCommentsStore.getState().cancelDraft()}
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            onClick={() => useCommentsStore.getState().cancelDraft()}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!body.trim() || busy}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={submit}
          >
            Comment
          </button>
        </div>
      </div>
    </>
  );
}

const ThreadPopover = memo(function ThreadPopover({
  thread,
  top,
  left,
}: {
  thread: CommentThreadData;
  top: number;
  left: number;
}) {
  const members = useCommentsStore((s) => s.members);
  const userId = useAuthStore((s) => s.user?.id);
  const role = usePermissionStore((s) => s.role);
  const canModerate = role === 'owner' || role === 'admin';
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const resolved = !!thread.resolvedAt;
  const store = useCommentsStore.getState;

  const sendReply = async () => {
    if (!reply.trim() || busy) return;
    setBusy(true);
    const ok = await store().reply(thread.id, reply.trim(), mentionsInBody(reply, members));
    setBusy(false);
    if (ok) setReply('');
  };

  return (
    <div
      role="dialog"
      aria-label="Comment thread"
      data-testid="comment-thread"
      className="pointer-events-auto absolute flex max-h-[70%] flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
      style={{ left, top: Math.max(8, top), width: POPOVER_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
        <span className="text-xs font-medium text-gray-500">
          {resolved ? 'Resolved' : 'Comment'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-xs ${
              resolved ? 'text-gray-600 hover:bg-gray-100' : 'text-green-700 hover:bg-green-50'
            }`}
            onClick={() => void store().setResolved(thread.id, !resolved)}
          >
            {resolved ? 'Reopen' : '✓ Resolve'}
          </button>
          {(thread.createdBy === userId || canModerate) && (
            <button
              type="button"
              aria-label="Delete thread"
              title="Delete thread"
              className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => {
                if (confirm('Delete this thread and all its replies?')) {
                  void store().deleteThread(thread.id);
                }
              }}
            >
              🗑
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            className="rounded px-1.5 py-0.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            onClick={() => store().openThread(null)}
          >
            ×
          </button>
        </div>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {thread.comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            members={members}
            mine={c.author.id === userId}
            canModerate={canModerate}
          />
        ))}
      </ol>

      <div className="border-t border-gray-100 p-2">
        <MentionTextarea
          value={reply}
          onChange={setReply}
          members={members}
          disabled={busy}
          placeholder="Reply… (@ to mention)"
          testId="comment-reply"
          onSubmit={sendReply}
          onCancel={() => store().openThread(null)}
        />
      </div>
    </div>
  );
});

function CommentItem({
  comment,
  members,
  mine,
  canModerate,
}: {
  comment: CommentData;
  members: Member[];
  mine: boolean;
  canModerate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const mentioned = useMemo(
    () => members.filter((m) => comment.mentions.includes(m.id)),
    [members, comment.mentions],
  );

  const save = async () => {
    const ok = await useCommentsStore
      .getState()
      .editComment(comment.id, text.trim(), mentionsInBody(text, members));
    if (ok) setEditing(false);
  };

  return (
    <li className="group mb-3 last:mb-0" data-testid="comment">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
          {initials(comment.author.name)}
        </span>
        <span className="text-xs font-semibold text-gray-800">{comment.author.name}</span>
        <span
          className="text-[11px] text-gray-400"
          title={new Date(comment.createdAt).toLocaleString()}
        >
          {relativeTime(comment.createdAt)}
          {comment.editedAt ? ' · edited' : ''}
        </span>
        {(mine || canModerate) && !editing && (
          <span className="ml-auto hidden gap-1 group-hover:flex group-focus-within:flex">
            {mine && (
              <button
                type="button"
                className="text-[11px] text-gray-400 hover:text-gray-700"
                onClick={() => {
                  setText(comment.body);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="text-[11px] text-gray-400 hover:text-red-600"
              onClick={() =>
                void useCommentsStore.getState().deleteComment(comment.id, comment.threadId)
              }
            >
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1 pl-8">
          <MentionTextarea
            value={text}
            onChange={setText}
            members={members}
            autoFocus
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words pl-8 text-sm text-gray-800">
          {bodySegments(comment.body, mentioned).map((seg, i) =>
            seg.mentionId ? (
              <span key={i} className="rounded bg-blue-50 px-0.5 font-medium text-blue-700">
                {seg.text}
              </span>
            ) : (
              <React.Fragment key={i}>{seg.text}</React.Fragment>
            ),
          )}
        </p>
      )}
    </li>
  );
}
