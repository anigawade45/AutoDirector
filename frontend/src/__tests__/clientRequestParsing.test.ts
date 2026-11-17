import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, request, extractCleanErrorMessage } from '../api/client';
import { AuthStorage } from '../utils/authStorage';

describe('API Client Request Parsing & Error Handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => {
        store.set(k, String(v));
      }),
      removeItem: vi.fn((k: string) => {
        store.delete(k);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
      key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
      get length() {
        return store.size;
      },
    };
    (global as any).localStorage = mockStorage;
    (global as any).sessionStorage = mockStorage;
    AuthStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('successfully parses standard JSON API envelope responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({
        success: true,
        data: { projectId: 'prj_test_123', title: 'Director Demo' },
      }),
    });

    const result = await api.getProject('prj_test_123');
    expect(result).toEqual({ projectId: 'prj_test_123', title: 'Director Demo' });
  });

  it('safely handles 502 Bad Gateway HTML proxy responses without throwing SyntaxError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null),
      },
      text: async () => '<html><body>502 Bad Gateway: Upstream server unavailable</body></html>',
    });

    try {
      await api.getProject('prj_bad_gw');
      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('Error');
      expect(err.name).not.toBe('SyntaxError');
      expect(err.status).toBe(502);
      expect(err.message).toContain('502 Bad Gateway');
      expect(err.code).toBe('HTTP_502');
    }
  });

  it('safely handles 504 Gateway Timeout plain text without throwing SyntaxError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      statusText: 'Gateway Timeout',
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/plain' : null),
      },
      text: async () => 'Gateway timeout connecting to render worker',
    });

    await expect(api.getProject('prj_timeout')).rejects.toMatchObject({
      status: 504,
      code: 'HTTP_504',
      message: 'Gateway timeout connecting to render worker',
    });
  });

  it('clears stored auth token on 401 Unauthorized responses', async () => {
    // Generate valid unexpired JWT
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(
      JSON.stringify({ id: 'usr_1', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64');
    const validToken = `${header}.${payload}.sig`;

    AuthStorage.setSession(validToken, {
      id: 'usr_1',
      email: 'user@test.com',
      name: 'User',
      tier: 'pro',
    });
    expect(AuthStorage.getToken()).toBe(validToken);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Token expired or invalid' },
      }),
    });

    await expect(api.getMe()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });

    expect(AuthStorage.getToken()).toBeNull();
  });

  it('propagates explicit error when job subscription stream fails to connect', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        get: () => 'text/plain',
      },
      body: null,
    });

    const onProgress = vi.fn();
    const onError = vi.fn();

    const unsubscribe = api.subscribeToJobEvents('job_error_test', onProgress, onError);

    // Allow promise tick
    await new Promise((r) => setTimeout(r, 50));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain('HTTP 500');

    unsubscribe();
  });

  it('propagates explicit error when job terminal state is failed', async () => {
    // Mock getJobStatus polling response with failed state
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => null },
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          data: {
            id: 'job_fail_123',
            state: 'failed',
            error: { code: 'RENDER_FAILED', message: 'FFmpeg filter graph failed: invalid asset' },
          },
        }),
      });
    });

    const onProgress = vi.fn();
    const onError = vi.fn();

    const unsubscribe = api.subscribeToJobEvents('job_fail_123', onProgress, onError);

    // Wait for poll
    await new Promise((r) => setTimeout(r, 100));

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
      })
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'FFmpeg filter graph failed: invalid asset',
        code: 'RENDER_FAILED',
      })
    );

    unsubscribe();
  });

  describe('POT-006: Comprehensive Request Parsing & Non-JSON Resilience', () => {
    it('handles HTML error with <title> extraction in request()', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          get: () => 'text/html; charset=UTF-8',
        },
        text: async () =>
          '<html><head><title>503 Service Temporarily Unavailable</title></head><body><h1>Down for maintenance</h1></body></html>',
      });

      await expect(request('/test-endpoint')).rejects.toMatchObject({
        status: 503,
        code: 'HTTP_503',
        message: '503 Service Temporarily Unavailable',
      });
    });

    it('handles HTML error with <h1> extraction when <title> is missing in request()', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: {
          get: () => 'text/html',
        },
        text: async () =>
          '<html><body><div><h1>Edge Worker Failed</h1><p>Request timed out</p></div></body></html>',
      });

      await expect(request('/test-endpoint')).rejects.toMatchObject({
        status: 502,
        code: 'HTTP_502',
        message: 'Edge Worker Failed',
      });
    });

    it('handles empty error response body with statusText fallback in request()', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: () => null,
        },
        text: async () => '',
      });

      await expect(request('/test-endpoint')).rejects.toMatchObject({
        status: 500,
        code: 'HTTP_500',
        message: 'HTTP Error 500 (Internal Server Error)',
      });
    });

    it('handles 204 No Content successfully without throwing SyntaxError', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: {
          get: () => null,
        },
        text: async () => '',
      });

      const result = await request<void>('/test-endpoint');
      expect(result).toBeUndefined();
    });

    it('handles 200 OK with empty body successfully without throwing SyntaxError', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => 'text/plain',
        },
        text: async () => '   ',
      });

      const result = await request<void>('/test-endpoint');
      expect(result).toBeUndefined();
    });

    it('handles corrupted JSON response safely without throwing SyntaxError', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: () => 'application/json',
        },
        text: async () => '{"brokenJson": true, unexpected_token',
      });

      await expect(request('/test-endpoint')).rejects.toMatchObject({
        status: 500,
        code: 'HTTP_500',
        message: expect.stringContaining('{"brokenJson": true'),
      });
    });

    it('handles non-envelope JSON error payloads ({ error: "string" } and { message: "string" })', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify({ message: 'Rate limit exceeded: please slow down' }),
      });

      await expect(request('/test-endpoint')).rejects.toMatchObject({
        status: 429,
        code: 'HTTP_429',
        message: 'Rate limit exceeded: please slow down',
      });
    });

    it('extractCleanErrorMessage extracts title, heading, and strips tags correctly', () => {
      expect(extractCleanErrorMessage('')).toBeNull();
      expect(extractCleanErrorMessage('   ')).toBeNull();
      expect(extractCleanErrorMessage('<title>Proxy Error</title>')).toBe('Proxy Error');
      expect(extractCleanErrorMessage('<h2>Connection Reset</h2>')).toBe('Connection Reset');
      expect(extractCleanErrorMessage('<div><p>Simple text error</p></div>')).toBe('Simple text error');
      expect(extractCleanErrorMessage('Raw plain text failure message')).toBe('Raw plain text failure message');
    });
  });
});
