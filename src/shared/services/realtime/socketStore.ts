import { create } from 'zustand';

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface SocketState {
  status: SocketStatus;
  lastTransitionAt: number;
  set: (status: SocketStatus) => void;
}

export const useSocketStore = create<SocketState>(set => ({
  status: 'idle',
  lastTransitionAt: Date.now(),
  set: status => set({ status, lastTransitionAt: Date.now() }),
}));
