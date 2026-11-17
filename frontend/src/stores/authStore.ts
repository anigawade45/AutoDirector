import { create } from 'zustand';
import { UserProfile, RegisterRequest, LoginRequest } from '@ai-video/shared';
import { api } from '../api/client';
import { toast } from './toastStore';
import { AuthStorage } from '../utils/authStorage';

export type AuthBootstrapStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isBootstrapping: boolean;
  authStatus: AuthBootstrapStatus;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginRequest & { rememberMe?: boolean }) => Promise<boolean>;
  register: (data: RegisterRequest) => Promise<boolean>;
  logout: () => void;
  checkSession: () => Promise<void>;
  clearError: () => void;
  setUser: (user: UserProfile | null) => void;
  hydrateFromStorage: () => void;
}

/**
 * Safely computes initial authentication state with defensive try/catch blocks.
 * Protects against corrupted localStorage/sessionStorage JSON, malformed tokens,
 * or restricted browser environments (private mode / sandboxed iframes) throwing on startup.
 */
export function getInitialAuthState(): {
  token: string | null;
  user: UserProfile | null;
  hasInitialToken: boolean;
} {
  try {
    const token = AuthStorage.getToken();
    // Always attempt to safely read/sanitize stored user; if corrupted or malformed,
    // AuthStorage.getUser() purges it immediately via internal try/catch
    const user = AuthStorage.getUser();

    // If there is no valid token, any stored user is orphaned/stale, so clear it
    if (!token && user) {
      AuthStorage.clearUser();
    }

    const validUser = token ? user : null;
    return {
      token,
      user: validUser,
      hasInitialToken: !!token,
    };
  } catch {
    // If any unexpected storage or parsing exception occurs during initial hydration:
    // clear corrupted storage artifacts and fall back to safe unauthenticated state
    try {
      AuthStorage.clear();
    } catch {
      // Ignore
    }
    return {
      token: null,
      user: null,
      hasInitialToken: false,
    };
  }
}

const initialAuth = getInitialAuthState();

const store = create<AuthState>((set, get, storeApi) => {
  // In React 18 SSR / renderToStaticMarkup, useSyncExternalStore delegates to api.getServerState || api.getInitialState.
  // Returning storeApi.getState() guarantees accurate, reactive rendering across test environments and SSR.
  (storeApi as any).getServerState = () => (storeApi as any).getState();

  return {
    // Safe hydration: AuthStorage validates expiry, catches malformed JSON, and prevents app crash
    user: initialAuth.user,
    token: initialAuth.token,
    isAuthenticated: false,
    isInitialized: !initialAuth.hasInitialToken,
    isBootstrapping: initialAuth.hasInitialToken,
    authStatus: initialAuth.hasInitialToken ? 'bootstrapping' : 'unauthenticated',
    isLoading: false,
    error: null,

    hydrateFromStorage: () => {
      const state = getInitialAuthState();
      set({
        token: state.token,
        user: state.user,
        isAuthenticated: false,
        isInitialized: !state.hasInitialToken,
        isBootstrapping: state.hasInitialToken,
        authStatus: state.hasInitialToken ? 'bootstrapping' : 'unauthenticated',
        isLoading: false,
        error: null,
      });
    },

    clearError: () => set({ error: null }),

    setUser: (user) => {
      AuthStorage.setUser(user);
      set({ user, isAuthenticated: !!user });
    },

    login: async (credentials: LoginRequest & { rememberMe?: boolean }) => {
      set({ isLoading: true, error: null });
      try {
        const response = await api.login(credentials);
        AuthStorage.setSession(response.token, response.user, {
          rememberMe: credentials.rememberMe,
        });
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'authenticated',
          isLoading: false,
          error: null,
        });
        toast.success(`Welcome back, ${response.user.name}! Session authenticated.`, 'Signed In');
        return true;
      } catch (err: any) {
        const message =
          err?.status === 401 || err?.code === 'INVALID_CREDENTIALS'
            ? 'Invalid email or password. Please verify your credentials.'
            : err?.message || 'Login failed. Please check your credentials.';
        set({
          error: message,
          isLoading: false,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'unauthenticated',
        });
        toast.error(message, 'Authentication Error');
        return false;
      }
    },

    register: async (data: RegisterRequest) => {
      set({ isLoading: true, error: null });
      try {
        const response = await api.register(data);
        AuthStorage.setSession(response.token, response.user);
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'authenticated',
          isLoading: false,
          error: null,
        });
        toast.success(
          `Welcome to AutoDirector Studio, ${response.user.name}! ${response.user.tier.toUpperCase()} workspace ready.`,
          'Account Created'
        );
        return true;
      } catch (err: any) {
        const message =
          err?.status === 409 || err?.code === 'USER_EXISTS'
            ? `An account with this email already exists. Please sign in instead.`
            : err?.message || 'Registration failed. Please check your inputs.';
        set({
          error: message,
          isLoading: false,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'unauthenticated',
        });
        toast.error(message, 'Registration Error');
        return false;
      }
    },

    logout: () => {
      // Notify server to clear HttpOnly session cookie (SEC-010)
      api.logout().catch(() => {});
      AuthStorage.clear();
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitialized: true,
        isBootstrapping: false,
        authStatus: 'unauthenticated',
        error: null,
      });
      toast.info('You have safely signed out of AutoDirector Studio.', 'Logged Out');
    },

    checkSession: async () => {
      // Read fresh from storage via AuthStorage safely
      let token: string | null = null;
      try {
        token = AuthStorage.getToken();
      } catch {
        token = null;
      }

      if (!token) {
        set({
          isAuthenticated: false,
          user: null,
          token: null,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'unauthenticated',
          isLoading: false,
        });
        return;
      }

      // Actively bootstrapping & verifying session with backend
      set({
        token,
        isBootstrapping: true,
        isInitialized: false,
        authStatus: 'bootstrapping',
        isLoading: true,
        error: null,
      });

      try {
        const response = await api.getMe();
        if (response && response.user) {
          AuthStorage.setUser(response.user);
          set({
            user: response.user,
            token,
            isAuthenticated: true,
            isInitialized: true,
            isBootstrapping: false,
            authStatus: 'authenticated',
            isLoading: false,
            error: null,
          });
        } else {
          AuthStorage.clear();
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isInitialized: true,
            isBootstrapping: false,
            authStatus: 'unauthenticated',
            isLoading: false,
          });
        }
      } catch (err: any) {
        // If 401 Unauthorized, network error, or verification failure: token is invalid/revoked
        AuthStorage.clear();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isInitialized: true,
          isBootstrapping: false,
          authStatus: 'unauthenticated',
          isLoading: false,
        });
      }
    },
  };
});

export const useAuthStore = store;
