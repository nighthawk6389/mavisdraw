import { useAuthStore } from '../stores/authStore';
import { discardJournals, unsavedOnDevice } from './offlineJournal';

/**
 * Sign out of this browser. Edits that only exist on this device are
 * discarded (so the next person to sign in here never gets them), after
 * asking if there are any.
 */
export async function signOut(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (userId) {
    const unsaved = await unsavedOnDevice(userId);
    if (
      unsaved > 0 &&
      !window.confirm(
        `${unsaved} ${unsaved === 1 ? 'change' : 'changes'} on this device ${unsaved === 1 ? 'hasn’t' : 'haven’t'} been saved yet. Sign out anyway and discard ${unsaved === 1 ? 'it' : 'them'}?`,
      )
    ) {
      return;
    }
    await discardJournals(userId);
  }
  await useAuthStore.getState().logout();
}
