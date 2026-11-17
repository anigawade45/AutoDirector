import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api/client';
import { AuthStorage } from '../utils/authStorage';

describe('Frontend SSE Streaming Authentication Suite', () => {
  const mockStorage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();
    AuthStorage.clear();

    const localStorageMock = {
      getItem: (k: string) => mockStorage.get(k) || null,
      setItem: (k: string, v: string) => {
        mockStorage.set(k, v);
      },
      removeItem: (k: string) => {
        mockStorage.delete(k);
      },
      clear: () => {
        mockStorage.clear();
      },
    };

    (global as any).window = {
      localStorage: localStorageMock,
      sessionStorage: localStorageMock,
      location: { hostname: 'localhost' },
    };
    (global as any).localStorage = localStorageMock;
    (global as any).sessionStorage = localStorageMock;
  });

  afterEach(() => {
    AuthStorage.clear();
    delete (global as any).window;
    delete (global as any).localStorage;
    delete (global as any).sessionStorage;
    vi.restoreAllMocks();
  });

  it('streams job events using fetch with Authorization: Bearer header and zero query parameters', async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 7200;
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user_stream_test', exp: futureSec })
    ).toString('base64url');
    const validToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.validStreamSig`;

    AuthStorage.setSession(validToken, {
      id: 'user_stream_test',
      email: 'stream@studio.ai',
      name: 'Stream Tester',
      tier: 'pro',
      createdAt: '2026-11-16T12:00:00Z',
    });

    // Mock readable stream chunks
    const ssePayload =
      ': connected\n\n' +
      'event: progress\n' +
      'data: {"jobId":"job_test_stream","state":"analyzing","percent":35}\n\n' +
      'event: done\n' +
      'data: {"jobId":"job_test_stream","state":"done","percent":100}\n\n';

    const encoder = new TextEncoder();
    let readCount = 0;

    const mockStream = {
      getReader: () => ({
        read: async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(ssePayload) };
          }
          return { done: true, value: undefined };
        },
      }),
    };

    const capturedCalls: Array<{ url: string; headers: Record<string, string> }> = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      capturedCalls.push({
        url,
        headers: init?.headers || {},
      });
      return {
        ok: true,
        body: mockStream,
        json: async () => ({ success: true, data: {} }),
      };
    }) as any;

    const progressUpdates: any[] = [];
    const unsubscribe = api.subscribeToJobEvents('job_test_stream', (data) => {
      progressUpdates.push(data);
    });

    // Allow async stream to flush
    await new Promise((r) => setTimeout(r, 60));

    // Find the SSE events streaming fetch call
    const sseCall = capturedCalls.find((c) => c.url.includes('/events'));
    expect(sseCall).toBeDefined();

    // Verify URL does NOT have ?token= query parameter
    expect(sseCall!.url).toMatch(/\/jobs\/test_stream\/events$/);
    expect(sseCall!.url).not.toContain('?token=');
    expect(sseCall!.url).not.toContain(validToken);

    // Verify Authorization: Bearer header is sent
    expect(sseCall!.headers['Authorization']).toBe(`Bearer ${validToken}`);
    expect(sseCall!.headers['Accept']).toBe('text/event-stream');

    // Verify SSE chunks are parsed properly
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const terminalUpdate = progressUpdates[progressUpdates.length - 1];
    expect(terminalUpdate.state).toBe('done');
    expect(terminalUpdate.percent).toBe(100);

    unsubscribe();
  });

  it('handles unauthenticated streaming when no session token exists (omits Authorization header and avoids URL tokens)', async () => {
    // AuthStorage has no token
    const capturedCalls: Array<{ url: string; headers: Record<string, string> }> = [];

    const mockStream = {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
      }),
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      capturedCalls.push({
        url,
        headers: init?.headers || {},
      });
      return {
        ok: true,
        body: mockStream,
        json: async () => ({ success: true, data: {} }),
      };
    }) as any;

    const unsubscribe = api.subscribeToJobEvents('job_anon_stream', () => {});
    await new Promise((r) => setTimeout(r, 30));

    const sseCall = capturedCalls.find((c) => c.url.includes('/events'));
    expect(sseCall).toBeDefined();
    expect(sseCall!.url).toMatch(/\/jobs\/anon_stream\/events$/);
    expect(sseCall!.url).not.toContain('?token=');
    expect(sseCall!.headers['Authorization']).toBeUndefined();
    expect(sseCall!.headers['Accept']).toBe('text/event-stream');

    unsubscribe();
  });

  it('supports api.getJobEventsTicket to issue short-lived scoped stream tickets for EventSource clients', async () => {
    let requestedUrl = '';
    let requestMethod = '';

    const mockData = {
      ticket: 'ticket_0123456789abcdef0123456789abcdef0123456789abcdef',
      expiresInSeconds: 30,
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      requestedUrl = url;
      requestMethod = init?.method || 'GET';
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ success: true, data: mockData }),
        json: async () => ({
          success: true,
          data: mockData,
        }),
      };
    }) as any;

    const res = await api.getJobEventsTicket('job_ticket_client_test');

    expect(requestMethod).toBe('POST');
    expect(requestedUrl).toContain('/jobs/job_ticket_client_test/events-ticket');
    expect(res.ticket).toMatch(/^ticket_[a-f0-9]{48}$/);
    expect(res.expiresInSeconds).toBe(30);
  });

  it('aborts active fetch streams cleanly when unsubscribe() is invoked', async () => {
    let aborted = false;

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const signal = init?.signal as AbortSignal;
      if (signal) {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
      }
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise(() => {}), // Pending forever until aborted
          }),
        },
        json: async () => ({ success: true, data: {} }),
      };
    }) as any;

    const unsubscribe = api.subscribeToJobEvents('job_abort_test', () => {});
    await new Promise((r) => setTimeout(r, 20));

    expect(aborted).toBe(false);
    unsubscribe();
    expect(aborted).toBe(true);
  });

  it('notifies onError callback when SSE endpoint returns an HTTP error status', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } }),
      };
    }) as any;

    let receivedError: any = null;
    const unsubscribe = api.subscribeToJobEvents(
      'job_error_test',
      () => {},
      (err) => {
        receivedError = err;
      }
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(receivedError).not.toBeNull();
    expect(receivedError.message).toContain('HTTP 403');
    unsubscribe();
  });
});
