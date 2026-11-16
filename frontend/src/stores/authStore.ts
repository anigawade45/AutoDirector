import { create } from 'zustand';
import { UserProfile, RegisterRequest, LoginRequest } from '@ai-video/shared';
import { api } from '../api/client';
import { toast } from './toastStore';
import { AuthStorage } from '../utils/authStorage';

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
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

export const useAuthStore = create<AuthState>((set) => ({
  // Safe hydration: AuthStorage validates expiry, catches malformed JSON, and prevents app crash
  user: initialUser,
  token: initialToken,
  // If no token exists in storage, initialization is immediately complete (unauthenticated).
  // If a token exists in storage, authentication is deferred until checkSession verifies with the server,
  // preventing any privileged-view flash or race conditions.
  isAuthenticated: false,
  isInitialized: !initialToken,
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
      set({ error: message, isLoading: false, isInitialized: true });
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
      set({ error: message, isLoading: false, isInitialized: true });
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
      error: null,
    });
    toast.info('You have safely signed out of AutoDirector Studio.', 'Logged Out');
  },

  checkSession: async () => {
    const token = AuthStorage.getToken();
    if (!token) {
      set({ isAuthenticated: false, user: null, token: null, isInitialized: true });
      return;
    }

    try {
      const response = await api.getMe();
      if (response && response.user) {
        AuthStorage.setUser(response.user);
        set({
          user: response.user,
          token,
          isAuthenticated: true,
          isInitialized: true,
        });
      } else {
        AuthStorage.clear();
        set({ user: null, token: null, isAuthenticated: false, isInitialized: true });
      }
    } catch (err: any) {
      // If 401 Unauthorized or verification error, token is invalid/revoked
      AuthStorage.clear();
      set({ user: null, token: null, isAuthenticated: false, isInitialized: true });
    }
  },
}));
