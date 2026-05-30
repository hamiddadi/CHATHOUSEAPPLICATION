import { useCallback, useEffect, useRef, useState } from 'react';
import { searchHistoryApi } from '../api/searchHistoryApi';

/**
 * Search history (Module 11 / SEARCH-020).
 *
 * Auto-recording: pass a `commit(query)` callback to log a meaningful
 * search (typically on submit, not on every keystroke). The hook
 * de-dupes locally and on the server.
 *
 * Optimistic local list — server is source of truth on next mount.
 */
export const useExtSearchHistory = () => {
  const [items, setItems] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchHistoryApi
      .list()
      .then(r => {
        if (!cancelled) setItems(r);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Commit a query to history. Debounces 600ms so a fast typist doesn't
   * spam the server with intermediate strings.
   */
  const commit = useCallback((rawQuery: string): void => {
    const q = rawQuery.trim();
    if (q.length === 0) return;

    setItems(prev => {
      const filtered = prev.filter(p => p.toLowerCase() !== q.toLowerCase());
      return [q, ...filtered].slice(0, 20);
    });

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void searchHistoryApi.record(q).catch(() => undefined);
    }, 600);
  }, []);

  const remove = useCallback(async (query: string): Promise<void> => {
    setItems(prev => prev.filter(p => p.toLowerCase() !== query.toLowerCase()));
    await searchHistoryApi.remove(query).catch(() => undefined);
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    setItems([]);
    await searchHistoryApi.clear().catch(() => undefined);
  }, []);

  return { items, ready, commit, remove, clear };
};
