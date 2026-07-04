/**
 * AppProviders.invalidateRealtimeCaches — audit QA 2026-07-02 (TRANSVERSAL /
 * socket): the handler registered on socket RE-connections must invalidate
 * the realtime-backed caches (messages / groups / notifications) by key
 * PREFIX — every sub-key refetches — while leaving unrelated caches intact.
 */
import { queryClient } from './QueryProvider';
import { invalidateRealtimeCaches } from './AppProviders';

describe('invalidateRealtimeCaches', () => {
  afterEach(() => {
    queryClient.clear();
  });

  it('invalidates messages/groups/notifications by prefix and spares other caches', () => {
    queryClient.setQueryData(['messages', 'unread'], 2);
    queryClient.setQueryData(['messages', 'messages', 'c1'], []);
    queryClient.setQueryData(['groups', 'list'], []);
    queryClient.setQueryData(['groups', 'messages', 'g1'], []);
    queryClient.setQueryData(['notifications', 'list', 'all'], []);
    queryClient.setQueryData(['rooms', 'feed'], []);

    invalidateRealtimeCaches();

    const isInvalidated = (key: unknown[]): boolean | undefined =>
      queryClient.getQueryState(key)?.isInvalidated;

    expect(isInvalidated(['messages', 'unread'])).toBe(true);
    expect(isInvalidated(['messages', 'messages', 'c1'])).toBe(true);
    expect(isInvalidated(['groups', 'list'])).toBe(true);
    expect(isInvalidated(['groups', 'messages', 'g1'])).toBe(true);
    expect(isInvalidated(['notifications', 'list', 'all'])).toBe(true);
    expect(isInvalidated(['rooms', 'feed'])).toBe(false);
  });
});
