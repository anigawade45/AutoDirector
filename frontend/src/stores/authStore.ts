import { create } from 'zustand';
import { UserProfile, RegisterRequest, LoginRequest } from '@ai-video/shared';
import { api } from '../api/client';
import { toast } from './toastStore';

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

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export const useAuthStore = create<AuthState>((set) => ({
  user:
    typeof window !== 'undefined' && localStorage.getItem(USER_KEY)
      ? JSON.parse(localStorage.getItem(USER_KEY)!)
      : null,
  token: typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem(TOKEN_KEY) : false,
  isLoading: false,
  error: null,

  clearError: () => set({ error: null }),

  setUser: (user) => {
    if (user && typeof window !== 'undefined') {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else if (typeof window !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
    set({ user, isAuthenticated: !!user });
  },

  login: async (credentials: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.login(credentials);
      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, response.token);
        localStorage.setItem(USER_KEY, JSON.stringify(response.user));
      }
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
      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, response.token);
        localStorage.setItem(USER_KEY, JSON.stringify(response.user));
      }
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
    toast.info('You have safely signed out of AutoDirector Studio.', 'Logged Out');
  },

  checkSession: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token) {
      set({ isAuthenticated: false, user: null, token: null });
      return;
    }

    try {
      const response = await api.getMe();
      if (response && response.user) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(USER_KEY, JSON.stringify(response.user));
        }
        set({
          user: response.user,
          token,
          isAuthenticated: true,
        });
      }
    } catch (err: any) {
      // If 401 Unauthorized, token is expired or invalid
      if (err?.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
        set({ user: null, token: null, isAuthenticated: false });
      }
    }
  },
}));
