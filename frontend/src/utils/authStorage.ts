import { UserProfile } from '@ai-video/shared';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// In-memory cache for fast, safe access without repeated DOM storage reads
let inMemoryToken: string | null = null;
let inMemoryUser: UserProfile | null = null;

/**
 * Check if the browser environment supports Web Storage (localStorage/sessionStorage).
 */
function getStorage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window[type];
    if (!storage) return null;
    const testKey = '__storage_test__';
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Safely inspects a JWT payload to check if it has expired.
 * Does not perform cryptographic signature verification (server does that),
 * but prevents hydrating the frontend state with an expired token.
 */
export function isJwtExpired(token: string): boolean {
  if (!token || typeof token !== 'string') return true;
  const parts = token.split('.');
  if (parts.length !== 3) return true;

  try {
    // Base64Url decode
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decodedJson =
      typeof Buffer !== 'undefined'
        ? Buffer.from(base64, 'base64').toString('utf-8')
        : typeof atob === 'function'
          ? decodeURIComponent(
              atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
            )
          : '';
    const payload = JSON.parse(decodedJson);

    if (payload.exp && typeof payload.exp === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      return payload.exp <= nowSec;
    }
    return false;
  } catch {
    return true; // Malformed payload
  }
}

export const AuthStorage = {
  TOKEN_KEY,
  USER_KEY,

  /**
   * Retrieves the current authentication token.
   * Priority:
   * 1. In-memory cache
   * 2. sessionStorage (tab-isolated)
   * 3. localStorage (persistent fallback)
   * Automatically clears and returns null if the token is expired.
   */
  getToken(): string | null {
    // 1. Check in-memory token
    if (inMemoryToken) {
      if (isJwtExpired(inMemoryToken)) {
        this.clearToken();
        return null;
      }
      return inMemoryToken;
    }

    // 2. Check sessionStorage
    const sessionStore = getStorage('sessionStorage');
    let token: string | null = null;
    if (sessionStore) {
      try {
        token = sessionStore.getItem(TOKEN_KEY);
      } catch {
        // Ignore storage access error
      }
    }

    // 3. Check localStorage
    if (!token) {
      const localStore = getStorage('localStorage');
      if (localStore) {
        try {
          token = localStore.getItem(TOKEN_KEY);
        } catch {
          // Ignore storage access error
        }
      }
    }

    if (!token) {
      return null;
    }

    // Check expiration before returning
    if (isJwtExpired(token)) {
      this.clearToken();
      return null;
    }

    inMemoryToken = token;
    return token;
  },

  /**
   * Check if an active, non-expired token exists.
   */
  hasToken(): boolean {
    return !!this.getToken();
  },

  /**
   * Safely retrieves and deserializes the stored user profile.
   * Uses robust try/catch: if localStorage has corrupted or invalid JSON,
   * it purges the corrupted key and returns null without crashing the application.
   */
  getUser(): UserProfile | null {
    if (inMemoryUser) {
      return inMemoryUser;
    }

    const sessionStore = getStorage('sessionStorage');
    const localStore = getStorage('localStorage');

    let raw: string | null = null;
    try {
      raw = sessionStore?.getItem(USER_KEY) || localStore?.getItem(USER_KEY) || null;
    } catch {
      raw = null;
    }

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const userId = parsed && typeof parsed === 'object' ? (parsed.id || parsed._id) : null;
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof userId === 'string' &&
        userId.trim().length > 0
      ) {
        const userProfile: UserProfile = {
          ...parsed,
          id: userId,
        };
        inMemoryUser = userProfile;
        return userProfile;
      }
      // Malformed object structure or invalid ID type
      this.clearUser();
      return null;
    } catch {
      // Corrupted JSON! Safely purge to prevent crash loops
      this.clearUser();
      return null;
    }
  },

  /**
   * Sets the auth session (token and user profile).
   * Supports session-only mode (options.rememberMe === false or options.sessionOnly === true)
   * which stores the token strictly in tab-scoped sessionStorage and memory, eliminating
   * persistent token exposure in localStorage (SEC-010).
   */
  setSession(
    token: string,
    user: UserProfile,
    options?: { rememberMe?: boolean; sessionOnly?: boolean }
  ): void {
    inMemoryToken = token;
    inMemoryUser = user;

    const sessionStore = getStorage('sessionStorage');
    const localStore = getStorage('localStorage');
    const serializedUser = JSON.stringify(user);

    const isSessionOnly = options?.sessionOnly === true || options?.rememberMe === false;

    try {
      sessionStore?.setItem(TOKEN_KEY, token);
      sessionStore?.setItem(USER_KEY, serializedUser);
    } catch {
      // Ignore sessionStorage errors
    }

    try {
      if (isSessionOnly) {
        // Security (SEC-010): In session-only mode, eliminate token persistence in localStorage
        // to mitigate long-term XSS theft or shared terminal exposure
        localStore?.removeItem(TOKEN_KEY);
      } else {
        localStore?.setItem(TOKEN_KEY, token);
      }
      localStore?.setItem(USER_KEY, serializedUser);
    } catch {
      // Ignore localStorage errors
    }
  },

  /**
   * Security (SEC-010): Migrates persistent localStorage token to tab-scoped sessionStorage,
   * purging the token from localStorage to reduce persistent token theft exposure.
   */
  migrateToSessionOnly(): void {
    const token = this.getToken();
    if (token) {
      try {
        getStorage('sessionStorage')?.setItem(TOKEN_KEY, token);
      } catch {}
    }
    try {
      getStorage('localStorage')?.removeItem(TOKEN_KEY);
    } catch {}
  },

  /**
   * Checks whether the current session is tab-scoped (stored only in sessionStorage).
   */
  isSessionOnly(): boolean {
    const localStore = getStorage('localStorage');
    const sessionStore = getStorage('sessionStorage');
    return !localStore?.getItem(TOKEN_KEY) && !!sessionStore?.getItem(TOKEN_KEY);
  },

  /**
   * Updates only the user profile in storage.
   */
  setUser(user: UserProfile | null): void {
    inMemoryUser = user;

    const sessionStore = getStorage('sessionStorage');
    const localStore = getStorage('localStorage');

    if (user) {
      const serializedUser = JSON.stringify(user);
      try {
        sessionStore?.setItem(USER_KEY, serializedUser);
        localStore?.setItem(USER_KEY, serializedUser);
      } catch {
        // Ignore
      }
    } else {
      this.clearUser();
    }
  },

  /**
   * Clears the stored token.
   */
  clearToken(): void {
    inMemoryToken = null;
    try {
      getStorage('sessionStorage')?.removeItem(TOKEN_KEY);
    } catch {}
    try {
      getStorage('localStorage')?.removeItem(TOKEN_KEY);
    } catch {}
  },

  /**
   * Clears the stored user profile.
   */
  clearUser(): void {
    inMemoryUser = null;
    try {
      getStorage('sessionStorage')?.removeItem(USER_KEY);
    } catch {}
    try {
      getStorage('localStorage')?.removeItem(USER_KEY);
    } catch {}
  },

  /**
   * Resets in-memory cached token and user without touching persistent storage.
   */
  clearMemoryCache(): void {
    inMemoryToken = null;
    inMemoryUser = null;
  },

  /**
   * Completely clears all session and persistent auth artifacts.
   */
  clear(): void {
    inMemoryToken = null;
    inMemoryUser = null;
    this.clearToken();
    this.clearUser();
  },
};
