/**
 * Build-time fallback used only outside production.
 *
 * Production must provide the reviewed values through the environment. The
 * go-live preflight compares this fallback, the mobile build value, every
 * Markdown document and every Store answer sheet with
 * docs/legal/document-control.json.
 */
export const LEGAL_DOCUMENT_FALLBACK_VERSION = '2026-07-29';
export const LEGAL_DOCUMENT_FALLBACK_EFFECTIVE_DATE = 'Not published';
