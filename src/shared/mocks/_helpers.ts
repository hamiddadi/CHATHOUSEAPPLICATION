import { MOCK_USER_SUMMARIES } from './users.mock';

/**
 * Shared mock helpers — factored out of the individual `*.mock.ts` files
 * to remove duplicated `pickUser`/`actor` definitions.
 */

/**
 * Safely picks a user summary by index, falling back to the first entry.
 * Throws (with the caller-supplied message) only if `MOCK_USER_SUMMARIES`
 * is empty, which would make any mock built on top of it invalid.
 *
 * @param idx - Index into `MOCK_USER_SUMMARIES`.
 * @param emptyMessage - Error message thrown when the list is empty.
 */
export const pickUser = (
  idx: number,
  emptyMessage: string,
): (typeof MOCK_USER_SUMMARIES)[number] => {
  const u = MOCK_USER_SUMMARIES[idx] ?? MOCK_USER_SUMMARIES[0];
  if (!u) throw new Error(emptyMessage);
  return u;
};
