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
  login: (credentials: LoginRequest) => Promise<boolean>;
  register: (data: RegisterRequest) => Promise<boolean>;
  logout: () => void;
  checkSession: () => Promise<void>;
  clearError: () => void;
  setUser: (user: UserProfile | null) => void;
}

const initialToken = AuthStorage.getToken();
const initialUser = initialToken ? AuthStorage.getUser() : null;
const hasInitialToken = !!initialToken;

const store = create<AuthState>((set, get, storeApi) => {
  // In React 18 SSR / renderToStaticMarkup, useSyncExternalStore delegates to api.getServerState || api.getInitialState.
  // Returning storeApi.getState() guarantees accurate, reactive rendering across test environments and SSR.
  (storeApi as any).getServerState = () => (storeApi as any).getState();

  return {
    // Safe hydration: AuthStorage validates expiry, catches malformed JSON, and prevents app crash
    user: initialUser,
    token: initialToken,
    isAuthenticated: false,
    isInitialized: !hasInitialToken,
    isBootstrapping: hasInitialToken,
    authStatus: hasInitialToken ? 'bootstrapping' : 'unauthenticated',
    isLoading: false,
    error: null,

  clearError: () => set({ error: null }),

  setUser: (user) => {
    AuthStorage.setUser(user);
    set({ user, isAuthenticated: !!user });
  },

  login: async (credentials: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.login(credentials);
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
    // Read fresh from storage to handle dynamic external token updates or tests
    const token =
      AuthStorage.getToken() ||
      (typeof window !== 'undefined'
        ? window.localStorage?.getItem('auth_token') ||
          window.sessionStorage?.getItem('auth_token')
        : null);

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
