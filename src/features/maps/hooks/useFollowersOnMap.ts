import { useEffect, useState } from 'react';
import { env } from '../../../config/env';
import { MOCK_FOLLOWERS_ON_MAP } from '../../../shared/mocks/followersOnMap.mock';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import type { FollowerOnMap } from '../../../shared/types/domain';

/**
 * Subscribes to followers presence via WebSocket.
 * Falls back to `MOCK_FOLLOWERS_ON_MAP` when `env.REALTIME_ENABLED === false`
 * so the feature is demo-able without a server.
 */
export const useFollowersOnMap = (): FollowerOnMap[] => {
  const [followers, setFollowers] = useState<FollowerOnMap[]>(
    env.REALTIME_ENABLED ? [] : [...MOCK_FOLLOWERS_ON_MAP],
  );

  useEffect(() => {
    if (!env.REALTIME_ENABLED) return;
    let cancelled = false;
    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      socket.emit('subscribe_followers_presence');
      socket.on('followers_presence', (list: FollowerOnMap[]) => {
        if (!cancelled) setFollowers(list);
      });
      socket.on('follower_moved', (f: FollowerOnMap) => {
        if (cancelled) return;
        setFollowers(prev => {
          const idx = prev.findIndex(p => p.id === f.id);
          if (idx === -1) return [...prev, f];
          const next = prev.slice();
          next[idx] = f;
          return next;
        });
      });
      socket.on('follower_offline', (userId: string) => {
        if (!cancelled) setFollowers(prev => prev.filter(p => p.id !== userId));
      });
    })();

    return () => {
      cancelled = true;
      // Don't disconnect the shared socket here — other consumers may still need it.
      void getSocket().then(s => {
        s?.off('followers_presence');
        s?.off('follower_moved');
        s?.off('follower_offline');
        s?.emit('unsubscribe_followers_presence');
      });
    };
  }, []);

  return followers;
};
