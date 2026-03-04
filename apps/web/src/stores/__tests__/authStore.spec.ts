import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock api module before import
vi.mock('../../services/api', () => ({
  apiLogin: vi.fn(),
  apiRegister: vi.fn(),
  apiLogout: vi.fn(),
  apiGetMe: vi.fn(),
  apiRefreshToken: vi.fn(),
  setAccessToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiError';
      this.statusCode = statusCode;
    }
  },
}));

import { useAuthStore } from '../authStore';
import {
  apiLogin,
  apiRegister,
  apiLogout,
  apiGetMe,
  apiRefreshToken,
  setAccessToken,
  ApiError,
} from '../../services/api';

const mockApiLogin = vi.mocked(apiLogin);
const mockApiRegister = vi.mocked(apiRegister);
const mockApiLogout = vi.mocked(apiLogout);
const mockApiGetMe = vi.mocked(apiGetMe);
const mockApiRefreshToken = vi.mocked(apiRefreshToken);
const mockSetAccessToken = vi.mocked(setAccessToken);

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe('login', () => {
    it('should set user and isAuthenticated on successful login', async () => {
      mockApiLogin.mockResolvedValueOnce({
        user: mockUser,
        accessToken: 'test-token',
      });

      await useAuthStore.getState().login('test@example.com', 'password');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockSetAccessToken).toHaveBeenCalledWith('test-token');
    });

    it('should set error on login failure', async () => {
      mockApiLogin.mockRejectedValueOnce(new ApiError('Invalid credentials', 401));

      await expect(
        useAuthStore.getState().login('test@example.com', 'wrong'),
      ).rejects.toThrow('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('should set generic error for non-ApiError failures', async () => {
      mockApiLogin.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        useAuthStore.getState().login('test@example.com', 'password'),
      ).rejects.toThrow('Network error');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Login failed');
    });
  });

  describe('register', () => {
    it('should set user and isAuthenticated on successful registration', async () => {
      mockApiRegister.mockResolvedValueOnce({
        user: mockUser,
        accessToken: 'new-token',
      });

      await useAuthStore.getState().register('test@example.com', 'password', 'Test User');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(mockSetAccessToken).toHaveBeenCalledWith('new-token');
    });

    it('should set error on registration failure', async () => {
      mockApiRegister.mockRejectedValueOnce(new ApiError('Email already exists', 409));

      await expect(
        useAuthStore.getState().register('test@example.com', 'password', 'Test'),
      ).rejects.toThrow('Email already exists');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Email already exists');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear user state and access token', async () => {
      // Start authenticated
      useAuthStore.setState({
        user: mockUser,
        isAuthenticated: true,
      });
      mockApiLogout.mockResolvedValueOnce(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    });

    it('should clear state even if API call fails', async () => {
      useAuthStore.setState({
        user: mockUser,
        isAuthenticated: true,
      });
      mockApiLogout.mockRejectedValueOnce(new Error('Network error'));

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    });
  });

  describe('initialize', () => {
    it('should restore session from refresh token', async () => {
      mockApiRefreshToken.mockResolvedValueOnce({ accessToken: 'refreshed-token' });
      mockApiGetMe.mockResolvedValueOnce({ user: mockUser });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(mockSetAccessToken).toHaveBeenCalledWith('refreshed-token');
    });

    it('should set unauthenticated if refresh fails', async () => {
      mockApiRefreshToken.mockRejectedValueOnce(new Error('No session'));

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('should set unauthenticated if getMe fails after refresh', async () => {
      mockApiRefreshToken.mockResolvedValueOnce({ accessToken: 'token' });
      mockApiGetMe.mockRejectedValueOnce(new Error('Unauthorized'));

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useAuthStore.setState({ error: 'Some error' });

      useAuthStore.getState().clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
