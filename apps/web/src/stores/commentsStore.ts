import { create } from 'zustand';
import {
  apiCreateThread,
  apiDeleteComment,
  apiDeleteThread,
  apiEditComment,
  apiListComments,
  apiListMembers,
  apiReplyToThread,
  apiResolveThread,
  type CommentThreadData,
  type Member,
} from '../services/api';
import { useDiagramStore } from './diagramStore';
import {
  ensureDiagramKnown,
  loadDiagramElements,
  refreshDiagramList,
} from '../services/diagramSync';
import { getCanvasController } from '../components/canvas/canvasController';
import { useElementsStore } from './elementsStore';
import { threadAnchor } from '../components/comments/commentUtils';
import { toast } from './toastStore';

/** Where a new thread will go, while its first comment is being written. */
export interface CommentDraft {
  diagramId: string;
  x: number;
  y: number;
  elementId: string | null;
  offsetX: number;
  offsetY: number;
}

interface CommentsState {
  projectId: string | null;
  /** All threads in the project, across every nested diagram. */
  threads: Map<string, CommentThreadData>;
  members: Member[];
  draft: CommentDraft | null;
  /** Thread whose popover is open. */
  activeThreadId: string | null;
  /** Thread to open once its diagram is on screen (deep links, notifications). */
  pendingThreadId: string | null;
  showResolved: boolean;
  panelOpen: boolean;

  load: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  startDraft: (draft: CommentDraft) => void;
  cancelDraft: () => void;
  submitDraft: (body: string, mentions: string[]) => Promise<boolean>;
  reply: (threadId: string, body: string, mentions: string[]) => Promise<boolean>;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  deleteComment: (commentId: string, threadId: string) => Promise<void>;
  editComment: (commentId: string, body: string, mentions: string[]) => Promise<boolean>;
  openThread: (threadId: string | null) => void;
  /** Drill to the thread's diagram, center its pin and open it. */
  goToThread: (threadId: string) => Promise<void>;
  setShowResolved: (value: boolean) => void;
  setPanelOpen: (value: boolean) => void;
}

function withThread(
  threads: Map<string, CommentThreadData>,
  thread: CommentThreadData,
): Map<string, CommentThreadData> {
  const next = new Map(threads);
  next.set(thread.id, thread);
  return next;
}

let loadSeq = 0;

export const useCommentsStore = create<CommentsState>((set, get) => ({
  projectId: null,
  threads: new Map(),
  members: [],
  draft: null,
  activeThreadId: null,
  pendingThreadId: null,
  showResolved: false,
  panelOpen: false,

  load: async (projectId) => {
    if (get().projectId !== projectId) {
      set({
        projectId,
        threads: new Map(),
        members: [],
        draft: null,
        activeThreadId: null,
      });
    }
    const seq = ++loadSeq;
    try {
      const [{ threads }, { members }] = await Promise.all([
        apiListComments(projectId),
        apiListMembers(projectId),
      ]);
      if (seq !== loadSeq || get().projectId !== projectId) return;
      set({ threads: new Map(threads.map((t) => [t.id, t])), members });
      // Threads on levels a teammate created after we opened the project
      const diagrams = useDiagramStore.getState().diagrams;
      if (threads.some((t) => !diagrams.has(t.diagramId))) void refreshDiagramList(projectId);
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  },

  refresh: async () => {
    const { projectId } = get();
    if (projectId) await get().load(projectId);
  },

  startDraft: (draft) => set({ draft, activeThreadId: null }),
  cancelDraft: () => set({ draft: null }),

  submitDraft: async (body, mentions) => {
    const { draft } = get();
    if (!draft) return false;
    try {
      const { thread } = await apiCreateThread(draft.diagramId, { ...draft, body, mentions });
      set((s) => ({
        threads: withThread(s.threads, thread),
        draft: null,
        activeThreadId: thread.id,
      }));
      return true;
    } catch (err) {
      toast(`Couldn't post comment: ${(err as Error).message}`, 'error');
      return false;
    }
  },

  reply: async (threadId, body, mentions) => {
    try {
      const { thread } = await apiReplyToThread(threadId, body, mentions);
      set((s) => ({ threads: withThread(s.threads, thread) }));
      return true;
    } catch (err) {
      toast(`Couldn't post reply: ${(err as Error).message}`, 'error');
      return false;
    }
  },

  setResolved: async (threadId, resolved) => {
    try {
      const { thread } = await apiResolveThread(threadId, resolved);
      set((s) => ({
        threads: withThread(s.threads, thread),
        // Resolving closes the thread unless resolved threads are shown
        activeThreadId: resolved && !s.showResolved ? null : s.activeThreadId,
      }));
      if (resolved) toast('Thread resolved', 'success');
    } catch (err) {
      toast(`Couldn't update thread: ${(err as Error).message}`, 'error');
    }
  },

  deleteThread: async (threadId) => {
    try {
      await apiDeleteThread(threadId);
      set((s) => {
        const threads = new Map(s.threads);
        threads.delete(threadId);
        return { threads, activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId };
      });
    } catch (err) {
      toast(`Couldn't delete thread: ${(err as Error).message}`, 'error');
    }
  },

  deleteComment: async (commentId, threadId) => {
    try {
      const { thread } = await apiDeleteComment(commentId);
      set((s) => {
        const threads = new Map(s.threads);
        if (thread) threads.set(thread.id, thread);
        else threads.delete(threadId);
        return {
          threads,
          activeThreadId: !thread && s.activeThreadId === threadId ? null : s.activeThreadId,
        };
      });
    } catch (err) {
      toast(`Couldn't delete comment: ${(err as Error).message}`, 'error');
    }
  },

  editComment: async (commentId, body, mentions) => {
    try {
      const { thread } = await apiEditComment(commentId, body, mentions);
      set((s) => ({ threads: withThread(s.threads, thread) }));
      return true;
    } catch (err) {
      toast(`Couldn't edit comment: ${(err as Error).message}`, 'error');
      return false;
    }
  },

  openThread: (threadId) => set({ activeThreadId: threadId, draft: null }),

  goToThread: async (threadId) => {
    const thread = get().threads.get(threadId);
    if (!thread) {
      // Not loaded yet (e.g. a notification from a just-created thread)
      set({ pendingThreadId: threadId });
      await get().refresh();
      if (!get().threads.has(threadId)) return;
      return get().goToThread(threadId);
    }
    set({ pendingThreadId: null, draft: null });
    if (!(await ensureDiagramKnown(thread.diagramId))) return;
    const diagrams = useDiagramStore.getState();
    if (diagrams.activeDiagramId !== thread.diagramId) {
      diagrams.navigateToDiagram(thread.diagramId);
      await loadDiagramElements(thread.diagramId).catch(() => undefined);
      // Let the canvas pick up the new diagram before moving the viewport
      await new Promise((r) => requestAnimationFrame(r));
    }
    const at = threadAnchor(thread, useElementsStore.getState().elements);
    getCanvasController()?.centerOn?.(at);
    set({ activeThreadId: threadId, showResolved: get().showResolved || !!thread.resolvedAt });
  },

  setShowResolved: (value) => set({ showResolved: value }),
  setPanelOpen: (value) => {
    set({ panelOpen: value });
    // Threads on other levels may have changed while we weren't looking
    if (value) void get().refresh();
  },
}));
