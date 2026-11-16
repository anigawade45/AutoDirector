import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api/client';

describe('Frontend SSE Streaming Authentication Suite', () => {
  const mockStorage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();

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
      location: { hostname: 'localhost' },
    };
    (global as any).localStorage = localStorageMock;
  });

  afterEach(() => {
    delete (global as any).window;
    delete (global as any).localStorage;
    vi.restoreAllMocks();
  });

  it('streams job events using fetch with Authorization: Bearer header and zero query parameters', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.header-token-val';
    window.localStorage.setItem('auth_token', fakeToken);

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
    expect(sseCall!.url).not.toContain(fakeToken);

    // Verify Authorization: Bearer header is sent
    expect(sseCall!.headers['Authorization']).toBe(`Bearer ${fakeToken}`);
    expect(sseCall!.headers['Accept']).toBe('text/event-stream');

    // Verify SSE chunks are parsed properly
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const terminalUpdate = progressUpdates[progressUpdates.length - 1];
    expect(terminalUpdate.state).toBe('done');
    expect(terminalUpdate.percent).toBe(100);

    unsubscribe();
  });
});
