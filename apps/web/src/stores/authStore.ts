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

export const useAuthStore = create<AuthState>((set, get) => {
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
        const tokenResponse = await apiRefreshToken();
        setAccessToken(tokenResponse.accessToken);

        // Then get user info
        const userResponse = await apiGetMe();
        set({
          user: userResponse.user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
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
