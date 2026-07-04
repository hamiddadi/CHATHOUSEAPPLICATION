import { i18n } from '../../../core/i18n';
import { toAppError } from './errorHandler';

/**
 * `toAppError` is the pure mapping from any thrown input to the discriminated
 * union the UI consumes. We avoid importing `axios` directly because
 * jest-expo crashes when axios's fetch-adapter loads (ReadableStream
 * polyfill conflict). Instead we duck-type an axios-like error — `isAxiosError()`
 * only checks for the `isAxiosError` boolean on the object.
 */

interface FakeAxiosError extends Error {
  isAxiosError: true;
  code?: string;
  response?: { status: number; data?: unknown };
}

const axiosErr = (input: Partial<FakeAxiosError> & { message?: string }): FakeAxiosError => {
  const err = new Error(input.message ?? 'axios') as FakeAxiosError;
  err.isAxiosError = true;
  if (input.code !== undefined) err.code = input.code;
  if (input.response) err.response = input.response;
  return err;
};

describe('toAppError', () => {
  it('maps 401 to kind:auth', () => {
    expect(toAppError(axiosErr({ response: { status: 401 } })).kind).toBe('auth');
  });

  it('maps 403 to kind:forbidden', () => {
    expect(toAppError(axiosErr({ response: { status: 403 } })).kind).toBe('forbidden');
  });

  it('maps 404 to kind:notFound', () => {
    expect(toAppError(axiosErr({ response: { status: 404 } })).kind).toBe('notFound');
  });

  it('maps 422 with field errors to kind:validation + fields', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 422,
          data: { message: 'Invalid', errors: { email: 'invalid', password: 'too short' } },
        },
      }),
    );
    expect(res.kind).toBe('validation');
    expect(res.fields).toEqual({ email: 'invalid', password: 'too short' });
    expect(res.message).toBe('Invalid');
  });

  it('maps the real backend envelope (400 VALIDATION_001 + Zod details) to validation', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 400,
          data: {
            success: false,
            error: {
              code: 'VALIDATION_001',
              message: 'Invalid request payload',
              details: { title: ['Too short'], topics: ['Max 5'] },
            },
          },
        },
      }),
    );
    expect(res.kind).toBe('validation');
    expect(res.message).toBe('Invalid request payload');
    // Zod fieldErrors (string[]) flatten to the first message per field.
    expect(res.fields).toEqual({ title: 'Too short', topics: 'Max 5' });
  });

  it('surfaces the backend error.message for non-validation errors', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 403,
          data: { success: false, error: { message: 'Godmode is disabled' } },
        },
      }),
    );
    expect(res.kind).toBe('forbidden');
    expect(res.message).toBe('Godmode is disabled');
  });

  it('is idempotent — an already-normalized AppError passes through unchanged', () => {
    const appError = toAppError(axiosErr({ response: { status: 403 } }));
    // Re-normalizing must NOT collapse it to kind:unknown / "Unexpected error".
    const again = toAppError(appError);
    expect(again).toBe(appError);
    expect(again.kind).toBe('forbidden');
  });

  it('maps 429 to kind:rateLimited with the localized generic, never the raw backend text', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 429,
          data: { success: false, error: { code: 'RATE_LIMIT_001', message: 'Too many requests' } },
        },
      }),
    );
    expect(res.kind).toBe('rateLimited');
    expect(res.code).toBe('RATE_LIMIT_001');
    expect(res.message).toBe('Too many attempts. Please try again in a moment.');
  });

  it('maps 409 to kind:conflict and surfaces the backend message + code', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 409,
          data: { success: false, error: { code: 'AUTH_006', message: 'Username already taken' } },
        },
      }),
    );
    expect(res.kind).toBe('conflict');
    expect(res.code).toBe('AUTH_006');
    expect(res.message).toBe('Username already taken');
  });

  it('propagates the stable backend code so UI layers can localize it', () => {
    const res = toAppError(
      axiosErr({
        response: {
          status: 403,
          data: {
            success: false,
            error: { code: 'CLUB_006', message: 'Club creation limit reached' },
          },
        },
      }),
    );
    expect(res.kind).toBe('forbidden');
    expect(res.code).toBe('CLUB_006');
  });

  it('localizes generic kind messages through i18n (fr)', async () => {
    await i18n.changeLanguage('fr');
    try {
      const res = toAppError(axiosErr({ message: 'fetch failed' }));
      expect(res.kind).toBe('network');
      expect(res.message).toBe('Impossible de joindre le serveur. Vérifie ta connexion.');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('maps 5xx to kind:server', () => {
    expect(toAppError(axiosErr({ response: { status: 500 } })).kind).toBe('server');
    expect(toAppError(axiosErr({ response: { status: 503 } })).kind).toBe('server');
  });

  it('maps ECONNABORTED to kind:timeout', () => {
    expect(toAppError(axiosErr({ code: 'ECONNABORTED' })).kind).toBe('timeout');
  });

  it('maps a no-response error (server unreachable) to kind:network', () => {
    expect(toAppError(axiosErr({ message: 'fetch failed' })).kind).toBe('network');
  });

  it('wraps a plain Error as kind:unknown with its message', () => {
    const res = toAppError(new Error('boom'));
    expect(res.kind).toBe('unknown');
    expect(res.message).toBe('boom');
  });

  it('wraps a primitive as kind:unknown with the default message', () => {
    expect(toAppError('nope').kind).toBe('unknown');
    expect(toAppError(null).kind).toBe('unknown');
  });
});
