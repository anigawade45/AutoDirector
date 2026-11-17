import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthStorage, isJwtExpired } from '../utils/authStorage';
import { useAuthStore, getInitialAuthState } from '../stores/authStore';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    getMe: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
  },
}));

describe('AuthStorage & Safe Hydration Suite', () => {
  const localStorageMap = new Map<string, string>();
  const sessionStorageMap = new Map<string, string>();

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

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMap.clear();
    sessionStorageMap.clear();
    AuthStorage.clear();

    const mockLocal = createMockStorage(localStorageMap);
    const mockSession = createMockStorage(sessionStorageMap);

    (global as any).window = {
      localStorage: mockLocal,
      sessionStorage: mockSession,
      location: { hostname: 'localhost' },
    };
    (global as any).localStorage = mockLocal;
    (global as any).sessionStorage = mockSession;
  });

  afterEach(() => {
    AuthStorage.clear();
    delete (global as any).window;
    delete (global as any).localStorage;
    delete (global as any).sessionStorage;
    vi.restoreAllMocks();
  });

  describe('1. Corrupted Data & Safe Hydration (No Uncaught JSON.parse Crash)', () => {
    it('safely recovers from corrupted/invalid JSON in storage without throwing', () => {
      // Intentionally insert corrupted JSON in localStorage and sessionStorage
      localStorageMap.set('auth_user', '{ corrupted json: missing quote');
      sessionStorageMap.set('auth_user', 'undefined');

      // Must not throw an unhandled SyntaxError
      expect(() => {
        const user = AuthStorage.getUser();
        expect(user).toBeNull();
      }).not.toThrow();

      // Corrupted key should be safely purged
      expect(localStorageMap.has('auth_user')).toBe(false);
      expect(sessionStorageMap.has('auth_user')).toBe(false);
    });

    it('successfully deserializes and returns valid stored user profile', () => {
      const validUser = {
        id: 'usr_valid_01',
        name: 'Alex Director',
        email: 'alex@studio.ai',
        tier: 'pro' as const,
        createdAt: '2026-11-16T12:00:00Z',
        usage: { storageBytesUsed: 1024, renderMinutesUsed: 5, promptsToday: 1 },
      };

      localStorageMap.set('auth_user', JSON.stringify(validUser));

      const retrieved = AuthStorage.getUser();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('usr_valid_01');
      expect(retrieved?.email).toBe('alex@studio.ai');
    });

    it('rejects primitive JSON values (strings/numbers) and purges malformed user shape', () => {
      localStorageMap.set('auth_user', '"just a plain string"');

      const user = AuthStorage.getUser();
      expect(user).toBeNull();
      expect(localStorageMap.has('auth_user')).toBe(false);
    });
  });

  describe('2. JWT Expiration & Stale Session Protection', () => {
    it('detects and flags expired JWT tokens', () => {
      const pastSec = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const expiredPayload = Buffer.from(
        JSON.stringify({ sub: 'u1', email: 'e@x.com', exp: pastSec })
      ).toString('base64url');
      const expiredToken = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.dummySig`;

      expect(isJwtExpired(expiredToken)).toBe(true);
    });

    it('detects and validates non-expired JWT tokens', () => {
      const futureSec = Math.floor(Date.now() / 1000) + 86400; // 24 hours in future
      const futurePayload = Buffer.from(
        JSON.stringify({ sub: 'u1', email: 'e@x.com', exp: futureSec })
      ).toString('base64url');
      const validToken = `eyJhbGciOiJIUzI1NiJ9.${futurePayload}.dummySig`;

      expect(isJwtExpired(validToken)).toBe(false);
    });

    it('automatically purges and ignores expired tokens on retrieval', () => {
      const pastSec = Math.floor(Date.now() / 1000) - 60;
      const expiredPayload = Buffer.from(
        JSON.stringify({ sub: 'u1', email: 'e@x.com', exp: pastSec })
      ).toString('base64url');
      const expiredToken = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.dummySig`;

      localStorageMap.set('auth_token', expiredToken);

      const token = AuthStorage.getToken();
      expect(token).toBeNull();
      expect(AuthStorage.hasToken()).toBe(false);
      expect(localStorageMap.has('auth_token')).toBe(false);
    });
  });

  describe('3. In-Memory Session & Storage Synchronization', () => {
    it('sets session and synchronizes across in-memory cache and storage', () => {
      const validUser = {
        id: 'usr_mem_01',
        name: 'In-Memory User',
        email: 'mem@studio.ai',
        tier: 'enterprise' as const,
        createdAt: '2026-11-16T12:00:00Z',
      };
      const futureSec = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr_mem_01', email: 'mem@studio.ai', exp: futureSec })
      ).toString('base64url');
      const validToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.validSig`;

      AuthStorage.setSession(validToken, validUser);

      expect(AuthStorage.getToken()).toBe(validToken);
      expect(AuthStorage.getUser()?.name).toBe('In-Memory User');
      expect(AuthStorage.hasToken()).toBe(true);

      // Clears cleanly
      AuthStorage.clear();
      expect(AuthStorage.getToken()).toBeNull();
      expect(AuthStorage.getUser()).toBeNull();
      expect(AuthStorage.hasToken()).toBe(false);
    });
  });

  describe('4. Asynchronous Session Validation & Zero Privileged-View Flash', () => {
    it('completes initialization as unauthenticated when no token is in storage', async () => {
      AuthStorage.clear();
      await useAuthStore.getState().checkSession();

      const state = useAuthStore.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });

    it('verifies session with backend and transitions to authenticated when valid', async () => {
      const futureSec = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr_valid_02', email: 'valid@studio.ai', exp: futureSec })
      ).toString('base64url');
      const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;

      AuthStorage.setSession(token, {
        id: 'usr_valid_02',
        name: 'Valid User',
        email: 'valid@studio.ai',
        tier: 'pro',
        createdAt: '2026-11-16T12:00:00Z',
      });

      (api.getMe as any).mockResolvedValueOnce({
        user: {
          id: 'usr_valid_02',
          name: 'Valid User Server',
          email: 'valid@studio.ai',
          tier: 'pro',
          createdAt: '2026-11-16T12:00:00Z',
        },
      });

      await useAuthStore.getState().checkSession();

      const state = useAuthStore.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.name).toBe('Valid User Server');
    });

    it('transitions to unauthenticated without grant when backend rejects token with 401', async () => {
      const futureSec = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr_revoked_01', email: 'revoked@studio.ai', exp: futureSec })
      ).toString('base64url');
      const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;

      AuthStorage.setSession(token, {
        id: 'usr_revoked_01',
        name: 'Revoked User',
        email: 'revoked@studio.ai',
        tier: 'free',
        createdAt: '2026-11-16T12:00:00Z',
      });

      (api.getMe as any).mockRejectedValueOnce({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Token revoked or user deleted',
      });

      await useAuthStore.getState().checkSession();

      const state = useAuthStore.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(AuthStorage.hasToken()).toBe(false);
    });
  });

  describe('5. POT-008: Store Hydration Resilience & Defensive Exception Protection', () => {
    it('hydrates store safely when localStorage[auth_user] contains malformed/corrupted JSON', () => {
      localStorageMap.set('auth_user', '{"id": "usr_broken", "name": incomplete json');

      expect(() => {
        useAuthStore.getState().hydrateFromStorage();
      }).not.toThrow();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state.isBootstrapping).toBe(false);
      expect(state.authStatus).toBe('unauthenticated');
      expect(localStorageMap.has('auth_user')).toBe(false);
    });

    it('rejects non-object and non-valid user profiles during store hydration and cleans up keys', () => {
      // 1. Array
      localStorageMap.set('auth_user', JSON.stringify([{ id: 'usr_arr' }]));
      useAuthStore.getState().hydrateFromStorage();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorageMap.has('auth_user')).toBe(false);

      // 2. Numeric scalar
      localStorageMap.set('auth_user', '98765');
      useAuthStore.getState().hydrateFromStorage();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorageMap.has('auth_user')).toBe(false);

      // 3. Object with non-string id
      localStorageMap.set('auth_user', JSON.stringify({ id: 12345, name: 'Numeric ID' }));
      useAuthStore.getState().hydrateFromStorage();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorageMap.has('auth_user')).toBe(false);

      // 4. Object with empty whitespace id
      localStorageMap.set('auth_user', JSON.stringify({ id: '   ', name: 'Blank ID' }));
      useAuthStore.getState().hydrateFromStorage();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorageMap.has('auth_user')).toBe(false);
    });

    it('purges corrupted auth_user while preserving valid auth_token and bootstrapping session', async () => {
      const futureSec = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr_pot008_01', email: 'pot008@studio.ai', exp: futureSec })
      ).toString('base64url');
      const validToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.validSig`;

      localStorageMap.set('auth_token', validToken);
      localStorageMap.set('auth_user', '{ invalid: JSON: missing bracket');

      useAuthStore.getState().hydrateFromStorage();

      const state = useAuthStore.getState();
      expect(state.token).toBe(validToken);
      expect(state.user).toBeNull();
      expect(state.isBootstrapping).toBe(true);
      expect(state.authStatus).toBe('bootstrapping');
      expect(localStorageMap.has('auth_user')).toBe(false);

      // When checkSession runs, it re-fetches the user profile and completes authentication
      (api.getMe as any).mockResolvedValueOnce({
        user: {
          id: 'usr_pot008_01',
          name: 'Recovered User',
          email: 'pot008@studio.ai',
          tier: 'pro',
          createdAt: '2026-11-16T12:00:00Z',
        },
      });

      await useAuthStore.getState().checkSession();

      const recoveredState = useAuthStore.getState();
      expect(recoveredState.isAuthenticated).toBe(true);
      expect(recoveredState.user?.name).toBe('Recovered User');
      expect(localStorageMap.has('auth_user')).toBe(true);
    });

    it('survives DOMException or SecurityError when accessing storage (e.g. private browsing or sandboxed iframe)', () => {
      // Create throwing storage mock simulating SecurityError
      const throwingStorage = {
        getItem: () => {
          throw new Error('SecurityError: The operation is insecure.');
        },
        setItem: () => {
          throw new Error('SecurityError: The operation is insecure.');
        },
        removeItem: () => {
          throw new Error('SecurityError: The operation is insecure.');
        },
        clear: () => {
          throw new Error('SecurityError: The operation is insecure.');
        },
      };

      (global as any).window.localStorage = throwingStorage;
      (global as any).window.sessionStorage = throwingStorage;

      expect(() => {
        const initial = getInitialAuthState();
        expect(initial.token).toBeNull();
        expect(initial.user).toBeNull();
        expect(initial.hasInitialToken).toBe(false);
      }).not.toThrow();

      expect(() => {
        useAuthStore.getState().hydrateFromStorage();
      }).not.toThrow();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.authStatus).toBe('unauthenticated');
    });

    it('clears in-memory cache without modifying persistent storage via clearMemoryCache()', () => {
      const validUser = {
        id: 'usr_cache_test',
        name: 'Cache User',
        email: 'cache@studio.ai',
        tier: 'free' as const,
        createdAt: '2026-11-16T12:00:00Z',
      };
      const futureSec = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr_cache_test', exp: futureSec })
      ).toString('base64url');
      const validToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.validSig`;

      AuthStorage.setSession(validToken, validUser);
      expect(AuthStorage.getToken()).toBe(validToken);
      expect(AuthStorage.getUser()?.name).toBe('Cache User');

      // Clear only in-memory cache
      AuthStorage.clearMemoryCache();

      // Persistent storage items remain intact
      expect(localStorageMap.has('auth_token')).toBe(true);
      expect(localStorageMap.has('auth_user')).toBe(true);

      // Calling getUser re-hydrates fresh from storage
      expect(AuthStorage.getUser()?.name).toBe('Cache User');
    });
  });
});
