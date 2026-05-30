export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Builds a cursor-paginated page from rows fetched with `take: limit + 1`.
 *
 * The extra row signals `hasMore`; it is sliced off before mapping. The
 * `nextCursor` is derived from the last kept row via `cursorOf`, or `null`
 * when there are no further pages (or no rows).
 */
export const cursorPage = <Row, Out = Row>(
  rows: Row[],
  limit: number,
  cursorOf: (r: Row) => string,
  map: (r: Row) => Out = r => r as unknown as Out,
): CursorPage<Out> => {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  // The `kept.length` guard proves the last element exists before the assertion.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const nextCursor = hasMore && kept.length ? cursorOf(kept[kept.length - 1]!) : null;
  return { data: kept.map(map), nextCursor, hasMore };
};
