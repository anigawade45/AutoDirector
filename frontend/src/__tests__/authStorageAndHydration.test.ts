import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthStorage, isJwtExpired } from '../utils/authStorage';
import { useAuthStore } from '../stores/authStore';
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
});
