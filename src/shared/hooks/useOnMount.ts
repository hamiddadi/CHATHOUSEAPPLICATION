import { useEffect, useRef } from 'react';

/**
 * Runs `callback` exactly once after the component mounts.
 * Equivalent to `useEffect(cb, [])` but encapsulates the intent so
 * `react-hooks/exhaustive-deps` doesn't false-positive.
 */
export const useOnMount = (callback: () => void | (() => void)): void => {
  // Hold the latest callback in a ref so the effect can depend on [] only.
  // Depending on [callback] (an unstable inline function) would tear the effect
  // down on every render — running the returned cleanup mid-mount — while the
  // `ran` guard then skips re-registering it.
  const cbRef = useRef(callback);
  cbRef.current = callback;
  useEffect(() => {
    return cbRef.current();
  }, []);
};
