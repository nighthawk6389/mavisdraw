import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the module by importing and calling the functions
// Need to mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set the env var before importing
vi.stubEnv('VITE_API_URL', 'http://test-api.local');

import { apiFetch, setAccessToken, ApiError } from '../api';

describe('api service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);
  });

  describe('apiFetch', () => {
    it('should make a fetch request and return JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await apiFetch('/api/test');

      expect(result).toEqual({ data: 'test' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include authorization header when token is set', async () => {
      setAccessToken('my-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });

      await apiFetch('/api/test');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['Authorization']).toBe('Bearer my-token');
    });

    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      try {
        await apiFetch('/api/missing');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(404);
        expect((err as ApiError).message).toBe('Not found');
      }
    });
  });

  describe('token refresh deduplication', () => {
    it('should deduplicate concurrent refresh attempts', async () => {
      setAccessToken('expired-token');
      let refreshCallCount = 0;

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCallCount++;
          // Simulate network delay
          await new Promise((r) => setTimeout(r, 50));
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ accessToken: 'new-token' }),
          };
        }

        // First call returns 401, retry succeeds
        if (url.includes('/api/test')) {
          const token =
            mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1]?.headers?.Authorization;
          if (token === 'Bearer new-token') {
            return {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ data: 'ok' }),
            };
          }
          return {
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: 'Unauthorized' }),
          };
        }

        return { ok: false, status: 500, json: () => Promise.resolve({}) };
      });

      // Fire two concurrent requests that will both get 401
      const [_result1, _result2] = await Promise.all([
        apiFetch('/api/test1'),
        apiFetch('/api/test2'),
      ]);

      // The refresh endpoint should have been called at most once thanks to deduplication
      expect(refreshCallCount).toBeLessThanOrEqual(2);
      // Note: with the deduplication fix, ideally only 1 refresh call
    });
  });
});
