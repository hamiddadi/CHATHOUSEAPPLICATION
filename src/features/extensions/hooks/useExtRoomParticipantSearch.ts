import { useMemo, useState } from 'react';

/**
 * Pure in-memory filter for the in-room participants list (Module 5.18 /
 * ROOM-INT-036). Takes a list of participants (whatever shape the caller
 * already loads) and a query, returns a memoized filtered slice.
 *
 * Matches against `displayName` and `username` (case-insensitive). The
 * caller wires the input UI and the click-target.
 */

export interface ParticipantLike {
  id: string;
  displayName?: string | null;
  username?: string | null;
}

export const useExtRoomParticipantSearch = <P extends ParticipantLike>(
  participants: readonly P[],
): {
  query: string;
  setQuery: (q: string) => void;
  filtered: P[];
  isFiltering: boolean;
} => {
  const [query, setQuery] = useState('');

  const filtered = useMemo<P[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...participants];
    return participants.filter(p => {
      const display = (p.displayName ?? '').toLowerCase();
      const handle = (p.username ?? '').toLowerCase();
      return display.includes(q) || handle.includes(q);
    });
  }, [query, participants]);

  return {
    query,
    setQuery,
    filtered,
    isFiltering: query.trim().length > 0,
  };
};
