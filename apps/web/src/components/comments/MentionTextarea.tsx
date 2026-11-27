import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Member } from '../../services/api';
import { activeMentionQuery, initials, insertMention, matchMembers } from './commentUtils';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  testId?: string;
}

/**
 * Comment box with @mention autocomplete. Enter posts, Shift+Enter is a new
 * line; while the suggestion list is open, arrows pick and Enter/Tab insert.
 */
export default function MentionTextarea({
  value,
  onChange,
  members,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
  disabled,
  testId,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const query = activeMentionQuery(value, caret);
  const suggestions =
    query && query.start !== dismissedAt ? matchMembers(members, query.query) : [];
  const open = suggestions.length > 0;

  // Focus on the next frame: opening from a canvas click, the browser's
  // mousedown would otherwise move focus away right after mounting
  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  // Auto-grow and restore the caret after inserting a mention
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const pick = (member: Member) => {
    if (!query) return;
    const next = insertMention(value, query.start, caret, member);
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    onChange(next.text);
    ref.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(query!.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim()) onSubmit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel?.();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        aria-label={placeholder ?? 'Comment'}
        aria-autocomplete="list"
        aria-expanded={open}
        className="block w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm leading-snug focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setHighlight(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === highlight}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1 ${
                i === highlight ? 'bg-blue-50 text-blue-900' : 'text-gray-700'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-600">
                {initials(m.name)}
              </span>
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
