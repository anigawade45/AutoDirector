import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
  createdAt: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (options: Omit<ToastItem, 'id' | 'createdAt'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  clear: () => void;
}

let toastCounter = 0;
const timeouts = new Map<string, any>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (options) => {
    const id = `toast_${Date.now()}_${++toastCounter}`;
    const durationMs = options.durationMs ?? (options.type === 'error' ? 5500 : 4000);

    const newToast: ToastItem = {
      ...options,
      id,
      durationMs,
      createdAt: Date.now(),
    };

    set((state) => {
      // Keep at most 5 concurrent toasts to avoid screen clutter
      const current = state.toasts.length >= 5 ? state.toasts.slice(1) : state.toasts;
      return { toasts: [...current, newToast] };
    });

    if (durationMs > 0) {
      const timer = setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        timeouts.delete(id);
      }, durationMs);
      timeouts.set(id, timer);
    }

    return id;
  },

  removeToast: (id: string) => {
    if (timeouts.has(id)) {
      clearTimeout(timeouts.get(id));
      timeouts.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearToasts: () => {
    timeouts.forEach((timer) => clearTimeout(timer));
    timeouts.clear();
    set({ toasts: [] });
  },

  clear: () => {
    timeouts.forEach((timer) => clearTimeout(timer));
    timeouts.clear();
    set({ toasts: [] });
  },
}));

/**
 * Universal global toast invocation helper:
 * Callable anywhere inside React components or outside in stores and API clients.
 */
export const toast = {
  success: (message: string, title?: string, durationMs?: number) =>
    useToastStore.getState().addToast({ type: 'success', message, title, durationMs }),

  error: (message: string, title?: string, durationMs?: number) =>
    useToastStore.getState().addToast({ type: 'error', message, title, durationMs }),

  warning: (message: string, title?: string, durationMs?: number) =>
    useToastStore.getState().addToast({ type: 'warning', message, title, durationMs }),

  info: (message: string, title?: string, durationMs?: number) =>
    useToastStore.getState().addToast({ type: 'info', message, title, durationMs }),

  dismiss: (id: string) => useToastStore.getState().removeToast(id),

  clear: () => useToastStore.getState().clearToasts(),
};
