/**
 * Shared API contract types. Imported by both backend (response shape) and
 * frontend (consumer typing). Pure additive — neither side currently
 * imports from here, so adoption is opt-in.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Paginated<T> {
  items: T[];
  total: number;
  cursor?: string | null;
}
