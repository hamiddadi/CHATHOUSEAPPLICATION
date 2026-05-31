/**
 * Short, locale-aware "when" label for a scheduled room. Falls back to a
 * plain date for events further out than a week. Returns '' for a missing or
 * unparseable timestamp so callers can decide what to render.
 */
export const formatScheduled = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMin = Math.round((ts - Date.now()) / 60_000);
  if (diffMin <= 0) return 'Starting soon';
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay <= 7) return `in ${diffDay}d`;
  return new Date(ts).toLocaleDateString();
};
