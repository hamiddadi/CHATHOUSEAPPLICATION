/**
 * QueryProvider — audit QA 2026-07-02 (TRANSVERSAL):
 * - exports a module-level singleton `queryClient` that IS the client the
 *   provider mounts (so imperative access — authStore.signOut's clear(),
 *   the reconnect invalidation — hits the same cache as the hooks);
 * - wires TanStack's onlineManager to the NetInfo-fed network store so
 *   paused queries resume / refetchOnReconnect fires when back online.
 */
import React from 'react';
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { useNetworkStore } from '../../shared/services/network/networkStore';
import { QueryProvider, queryClient } from './QueryProvider';

describe('QueryProvider', () => {
  afterEach(() => {
    useNetworkStore.setState({ isOnline: true, lastTransitionAt: Date.now() });
    queryClient.clear();
  });

  it('mounts the exported singleton client (hook access === imperative access)', () => {
    let captured: QueryClient | null = null;
    const Probe: React.FC = () => {
      captured = useQueryClient();
      return null;
    };

    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );

    expect(captured).toBe(queryClient);
  });

  it('does not automatically replay mutations without an explicit idempotent opt-in', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('drives TanStack onlineManager from the network store', () => {
    // Keep at least one subscriber so onlineManager doesn't tear down the
    // event listener between assertions (it cleans up when listener-less).
    const unsubscribe = onlineManager.subscribe(() => undefined);
    try {
      expect(onlineManager.isOnline()).toBe(true);

      useNetworkStore.setState({ isOnline: false, lastTransitionAt: Date.now() });
      expect(onlineManager.isOnline()).toBe(false);

      useNetworkStore.setState({ isOnline: true, lastTransitionAt: Date.now() });
      expect(onlineManager.isOnline()).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
