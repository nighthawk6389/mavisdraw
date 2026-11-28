import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, useThemeStore } from '../stores/themeStore';

/** Dark mode: the system's choice until the person picks one, which is remembered. */
describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.getState().setPreference('system');
  });

  it('follows the system unless one was picked', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('switching remembers the choice and marks the page', () => {
    const before = useThemeStore.getState().theme;
    useThemeStore.getState().toggle();
    const after = useThemeStore.getState().theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('mavisdraw:theme')).toBe(after);
    expect(document.documentElement.classList.contains('dark')).toBe(after === 'dark');
    // Back to following the system: nothing remembered
    useThemeStore.getState().setPreference('system');
    expect(localStorage.getItem('mavisdraw:theme')).toBeNull();
  });
});
