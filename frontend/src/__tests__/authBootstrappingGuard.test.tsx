import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../App';
import { useAuthStore } from '../stores/authStore';
import { AuthStorage, isJwtExpired } from '../utils/authStorage';
import { api } from '../api/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function makeJwt(payloadObj: any): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  return `${header}.${payload}.mockSignature123`;
}

describe('POT-005: Frontend Auth Bootstrap & Protected Views Gating', () => {
  const localStorageMap = new Map<string, string>();
  const sessionStorageMap = new Map<string, string>();
  let queryClient: QueryClient;

  const createMockStorage = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) || null,
    setItem: (key: string, val: string) => {
      map.set(key, val);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'listProjects').mockResolvedValue([] as any);
    vi.spyOn(api, 'getProject').mockResolvedValue(null as any);
    localStorageMap.clear();
    sessionStorageMap.clear();
    AuthStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const mockLocal = createMockStorage(localStorageMap);
    const mockSession = createMockStorage(sessionStorageMap);

    (global as any).window = {
      localStorage: mockLocal,
      sessionStorage: mockSession,
      location: { pathname: '/', hash: '', search: '', hostname: 'localhost' },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    };
    (global as any).localStorage = mockLocal;
    (global as any).sessionStorage = mockSession;

    // Reset store to unauthenticated clean state
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isInitialized: true,
      isBootstrapping: false,
      authStatus: 'unauthenticated',
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    AuthStorage.clear();
    delete (global as any).window;
    delete (global as any).localStorage;
    delete (global as any).sessionStorage;
  });

  it('renders auth-bootstrapping splash and NO dashboard content while session check is in-flight with stored token', () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    const testToken = makeJwt({ sub: 'usr_test_01', exp: futureSec });

    // Simulate stored token
    localStorageMap.set('auth_token', testToken);

    // Put store in explicit bootstrapping state
    useAuthStore.setState({
      token: testToken,
      isAuthenticated: false,
      isInitialized: false,
      isBootstrapping: true,
      authStatus: 'bootstrapping',
    });

    const html = renderWithProviders(<App />);

    // Must render the unprivileged bootstrapping splash screen
    expect(html).toContain('data-testid="auth-bootstrapping-splash"');
    expect(html).toContain('Verifying AutoDirector Studio session...');

    // Must NOT render any protected dashboard or editor elements
    expect(html).not.toContain('ProjectDashboard');
    expect(html).not.toContain('New Project');
    expect(html).not.toContain('Active Projects');
    expect(html).not.toContain('Loading sequence &amp; timeline...');
  });

  it('transitions to Landing Page when session validation rejects invalid stored token', async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    const revokedToken = makeJwt({ sub: 'usr_revoked_01', exp: futureSec });
    localStorageMap.set('auth_token', revokedToken);

    vi.spyOn(api, 'getMe').mockRejectedValueOnce({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Token has been revoked or expired',
    });

    // Execute checkSession lifecycle
    await useAuthStore.getState().checkSession();

    const state = useAuthStore.getState();
    expect(state.isBootstrapping).toBe(false);
    expect(state.isInitialized).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.authStatus).toBe('unauthenticated');
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();

    // Render App in the resolved unauthenticated state
    const html = renderWithProviders(<App />);

    // Must render Landing Page
    expect(html).toContain('AutoDirector');
    expect(html).toContain('Sign In');
    expect(html).not.toContain('data-testid="auth-bootstrapping-splash"');
    expect(html).not.toContain('New Project');
    expect(html).not.toContain('Active Projects');
  });

  it('renders Landing Page and gates dashboard if unauthenticated user attempts direct /dashboard route', () => {
    (global as any).window.location.pathname = '/dashboard';

    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isInitialized: true,
      isBootstrapping: false,
      authStatus: 'unauthenticated',
    });

    const html = renderWithProviders(<App />);

    // Protected view gate forces LandingPage immediately during render
    expect(html).toContain('AutoDirector');
    expect(html).not.toContain('New Project');
    expect(html).not.toContain('Active Projects');
    expect(html).not.toContain('data-testid="auth-bootstrapping-splash"');
  });

  it('renders Landing Page and gates editor if unauthenticated user attempts direct /projects/:id route', () => {
    (global as any).window.location.pathname = '/projects/prj_confidential_42';

    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isInitialized: true,
      isBootstrapping: false,
      authStatus: 'unauthenticated',
    });

    const html = renderWithProviders(<App />);

    // Protected view gate forces LandingPage immediately during render
    expect(html).toContain('AutoDirector');
    expect(html).not.toContain('Loading sequence &amp; timeline...');
    expect(html).not.toContain('New Project');
    expect(html).not.toContain('data-testid="auth-bootstrapping-splash"');
  });

  it('renders ProjectDashboard only after session validation successfully authenticates', async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: 'usr_verified_99', exp: futureSec });
    const validUser = {
      id: 'usr_verified_99',
      name: 'Morgan Stanley',
      email: 'morgan@studio.ai',
      tier: 'pro' as const,
      createdAt: '2026-11-17T00:00:00Z',
    };

    AuthStorage.setSession(validToken, validUser);
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: validUser } as any);

    // Validate session
    await useAuthStore.getState().checkSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isInitialized).toBe(true);
    expect(state.isBootstrapping).toBe(false);
    expect(state.authStatus).toBe('authenticated');
    expect(state.user?.name).toBe('Morgan Stanley');

    // Simulate authenticated dashboard view
    (global as any).window.location.pathname = '/dashboard';
    const html = renderWithProviders(<App />);

    // Dashboard renders safely
    expect(html).not.toContain('data-testid="auth-bootstrapping-splash"');
    expect(html).toContain('New Project');
  });
});
