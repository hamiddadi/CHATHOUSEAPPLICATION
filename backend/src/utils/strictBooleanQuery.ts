import { z } from 'zod';

/**
 * Parse an HTTP query boolean without JavaScript truthiness. Express exposes
 * query values as strings, so `z.coerce.boolean()` would incorrectly turn
 * both "false" and "0" into `true`.
 */
export const strictBooleanQuery = z.preprocess(value => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}, z.boolean());
