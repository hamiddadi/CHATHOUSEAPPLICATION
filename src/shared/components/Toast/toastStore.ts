import { create } from 'zustand';

export type ToastTone = 'error' | 'success' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  show: (input: { message: string; tone?: ToastTone; durationMs?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 3_500;

let seq = 0;

export const useToastStore = create<ToastState>(set => ({
  toasts: [],
  show: ({ message, tone = 'info', durationMs = DEFAULT_DURATION_MS }) => {
    const id = `toast-${Date.now()}-${seq++}`;
    set(state => ({ toasts: [...state.toasts, { id, message, tone, duration: durationMs }] }));
    return id;
  },
  dismiss: id => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helpers — avoid calling `useToastStore.getState()` in consumers. */
export const toast = {
  error: (message: string, durationMs?: number) =>
    useToastStore.getState().show({ message, tone: 'error', durationMs }),
  success: (message: string, durationMs?: number) =>
    useToastStore.getState().show({ message, tone: 'success', durationMs }),
  info: (message: string, durationMs?: number) =>
    useToastStore.getState().show({ message, tone: 'info', durationMs }),
  warning: (message: string, durationMs?: number) =>
    useToastStore.getState().show({ message, tone: 'warning', durationMs }),
};
