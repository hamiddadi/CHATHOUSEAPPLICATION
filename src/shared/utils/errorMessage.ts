/**
 * Extracts a human-readable message from an unknown caught value, falling back
 * to `fallback`. Replaces the repeated `e instanceof Error ? e.message : '…'`
 * idiom scattered across screens/Alerts.
 */
export const errorMessage = (e: unknown, fallback = 'Une erreur est survenue'): string =>
  e instanceof Error ? e.message : fallback;
