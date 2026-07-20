/**
 * A uniqueness token for retry-safe mutations. This is not an auth secret:
 * entropy only prevents accidental collision, while ownership and payload
 * binding are enforced by the backend.
 */
export const createIdempotencyKey = (): string =>
  `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
