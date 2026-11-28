import { create } from 'zustand';

/**
 * Light or dark, following the system unless the person picked one (Alt+Shift+D,
 * the toolbar, or ⌘K). Remembered per browser; applied as `html.dark`, which
 * styles/dark.css keys on.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mavisdraw:theme';

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(preference: ThemePreference, system: Theme): Theme {
  return preference === 'system' ? system : preference;
}

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  /** Switch to the other theme (remembered from now on). */
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const preference = typeof window === 'undefined' ? 'system' : readPreference();
  const theme = typeof window === 'undefined' ? 'light' : resolveTheme(preference, systemTheme());
  return {
    preference,
    theme,
    setPreference: (next) => {
      try {
        if (next === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode: it lasts for this visit
      }
      const resolved = resolveTheme(next, systemTheme());
      apply(resolved);
      set({ preference: next, theme: resolved });
    },
    toggle: () => get().setPreference(get().theme === 'dark' ? 'light' : 'dark'),
  };
});

/** Apply the theme now, and follow the system while no theme was picked. */
export function initTheme(): void {
  apply(useThemeStore.getState().theme);
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (useThemeStore.getState().preference !== 'system') return;
      const theme: Theme = e.matches ? 'dark' : 'light';
      apply(theme);
      useThemeStore.setState({ theme });
    });
  } catch {
    // No matchMedia (tests): the stored or default theme stays
  }
}
