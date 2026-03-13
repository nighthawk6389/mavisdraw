import { create } from 'zustand';
import {
  apiLogin,
  apiRegister,
  apiLogout,
  apiGetMe,
  apiRefreshToken,
  setAccessToken,
  setOnUnauthorized,
  ApiError,
} from '../services/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
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
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  clearError: () => void;
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

    initialize: async () => {
      set({ isLoading: true });
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
        if (import.meta.env.DEV) {
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
    },

    clearError: () => set({ error: null }),
  };
});
