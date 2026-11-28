import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Elements Tab can reach inside `root`, in order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

/**
 * What every modal dialog does for people on a keyboard or a screen reader:
 * focus moves into it when it opens (unless something inside asked for
 * focus already, e.g. autoFocus), Tab and Shift+Tab stay inside it, Escape
 * closes it, and focus goes back to where it was when it closes.
 */
export function useModalDialog(
  ref: RefObject<HTMLElement | null>,
  onClose?: () => void,
  /** For dialogs that stay mounted while closed. */
  open = true,
): void {
  // The latest onClose, without re-running the effect when it changes
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const returnTo = document.activeElement as HTMLElement | null;
    if (!dialog.contains(document.activeElement)) {
      (focusableIn(dialog)[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close.current) {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture: the dialog's own controls and the editor's shortcuts come after
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [ref, open]);
}
