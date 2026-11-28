import { create } from 'zustand';
import {
  apiExchangeSso,
  apiLogin,
  apiRegister,
  apiLogout,
  apiGetMe,
  apiRefreshToken,
  setAccessToken,
  setOnUnauthorized,
  ApiError,
  type AuthResponse,
} from '../services/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Has the account confirmed its email? Invites to it wait until then. */
  emailVerified?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  /** Signed in some other way (e.g. a password reset): take the session. */
  signedIn: (response: AuthResponse) => void;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  clearError: () => void;
}

let initializing: Promise<void> | null = null;

/** The single sign-on code in the address (`#sso=…`), removed from it. */
export function takeSsoCode(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^#sso=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return match[1];
}

export const useAuthStore = create<AuthState>((set, _get) => {
  // Set up unauthorized callback
  setOnUnauthorized(() => {
    set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,

    login: async (email: string, password: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await apiLogin(email, password);
        setAccessToken(response.accessToken);
        set({
          user: response.user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Login failed';
        set({ isLoading: false, error: message });
        throw err;
      }
    },

    signedIn: (response: AuthResponse) => {
      setAccessToken(response.accessToken);
      set({ user: response.user, isAuthenticated: true, isLoading: false, error: null });
    },

    register: async (email: string, password: string, name: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await apiRegister(email, password, name);
        setAccessToken(response.accessToken);
        set({
          user: response.user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Registration failed';
        set({ isLoading: false, error: message });
        throw err;
      }
    },

    logout: async () => {
      try {
        await apiLogout();
      } catch {
        // Ignore logout errors
      }
      setAccessToken(null);
      set({ user: null, isAuthenticated: false });
    },

    initialize: () => {
      // Single-flight: StrictMode (and multiple callers) must not race two
      // refreshes with the same rotating refresh token, or the loser logs
      // the user out.
      if (!initializing) {
        initializing = runInitialize().finally(() => {
          initializing = null;
        });
      }
      return initializing;
    },

    clearError: () => set({ error: null }),
  };

  async function runInitialize(): Promise<void> {
    set({ isLoading: true });
    // Back from single sign-on: the API passed a one-time code in the
    // fragment. Take it out of the address first, whatever happens next
    const sso = takeSsoCode();
    if (sso) {
      try {
        const response = await apiExchangeSso(sso);
        setAccessToken(response.accessToken);
        set({ user: response.user, isAuthenticated: true, isLoading: false });
        return;
      } catch (err) {
        console.warn('[auth] Single sign-on code was refused:', err);
      }
    }
    try {
      // Try to refresh the token first
      console.log('[auth] Attempting token refresh...');
      const tokenResponse = await apiRefreshToken();
      setAccessToken(tokenResponse.accessToken);
      console.log('[auth] Token refresh succeeded');

      // Then get user info
      const userResponse = await apiGetMe();
      console.log('[auth] Got user:', userResponse.user.email);
      set({
        user: userResponse.user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (refreshErr) {
      console.log('[auth] Token refresh failed:', refreshErr);
      // In dev mode, auto-login as demo user
      console.log('[auth] DEV mode:', import.meta.env.DEV);
      if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_DEV_AUTO_LOGIN !== 'true') {
        try {
          console.log('[auth] Attempting dev auto-login as demo@mavisdraw.dev...');
          const response = await apiLogin('demo@mavisdraw.dev', 'password123');
          setAccessToken(response.accessToken);
          console.log('[auth] Dev auto-login succeeded for:', response.user.email);
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
          return;
        } catch (loginErr) {
          console.error('[auth] Dev auto-login FAILED:', loginErr);
          // Fall through to unauthenticated state if demo login fails
        }
      }
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }
});
