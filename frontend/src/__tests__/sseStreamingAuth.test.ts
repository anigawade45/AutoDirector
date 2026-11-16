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
});
