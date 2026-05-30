import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * quiescence. Replaces the hand-rolled useState + setTimeout/clearTimeout
 * effect duplicated across search screens.
 */
export const useDebouncedValue = <T>(value: T, delayMs = 250): T => {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
};
