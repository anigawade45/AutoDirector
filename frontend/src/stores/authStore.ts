import { create } from 'zustand';
import { UserProfile, RegisterRequest, LoginRequest } from '@ai-video/shared';
import { api } from '../api/client';
import { toast } from './toastStore';
import { AuthStorage } from '../utils/authStorage';

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
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

export const useAuthStore = create<AuthState>((set) => ({
  // Safe hydration: AuthStorage validates expiry, catches malformed JSON, and prevents app crash
  user: AuthStorage.getUser(),
  token: AuthStorage.getToken(),
  isAuthenticated: AuthStorage.hasToken(),
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
      set({ error: message, isLoading: false });
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
      set({ error: message, isLoading: false });
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
      error: null,
    });
    toast.info('You have safely signed out of AutoDirector Studio.', 'Logged Out');
  },

  checkSession: async () => {
    const token = AuthStorage.getToken();
    if (!token) {
      set({ isAuthenticated: false, user: null, token: null });
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
        });
      }
    } catch (err: any) {
      // If 401 Unauthorized, token is expired or invalid
      if (err?.status === 401) {
        AuthStorage.clear();
        set({ user: null, token: null, isAuthenticated: false });
      }
    }
  },
}));
