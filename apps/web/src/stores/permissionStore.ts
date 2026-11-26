import { create } from 'zustand';
import { setElementsReadOnly } from './elementsStore';

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

interface PermissionState {
  /** The signed-in user's role in the open project. */
  role: ProjectRole | null;
  canEdit: boolean;
  setRole: (role: ProjectRole | null) => void;
}

/** What the signed-in user may do in the open project. */
export const usePermissionStore = create<PermissionState>((set) => ({
  role: null,
  canEdit: true,
  setRole: (role) => {
    const canEdit = role !== 'viewer';
    // The store refuses local edits for viewers (remote updates still apply)
    setElementsReadOnly(!canEdit);
    set({ role, canEdit });
  },
}));

export function canEdit(): boolean {
  return usePermissionStore.getState().canEdit;
}
