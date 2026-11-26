import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional action button, e.g. "Undo". */
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, kind?: ToastKind, action?: Toast['action']) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const TIMEOUT_MS = 5000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'info', action) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message, action }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? TIMEOUT_MS * 2 : TIMEOUT_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React code. */
export function toast(message: string, kind: ToastKind = 'info', action?: Toast['action']): void {
  useToastStore.getState().show(message, kind, action);
}
