import { useEffect, useRef } from 'react';

/**
 * Runs `callback` exactly once after the component mounts.
 * Equivalent to `useEffect(cb, [])` but encapsulates the intent so
 * `react-hooks/exhaustive-deps` doesn't false-positive.
 */
export const useOnMount = (callback: () => void | (() => void)): void => {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    return callback();
    // Intentional: this hook is the source of truth for mount-once semantics.
  }, [callback]);
};
