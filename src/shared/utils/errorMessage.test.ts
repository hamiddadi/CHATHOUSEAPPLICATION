import { i18n } from '../../core/i18n';
import { errorMessage } from './errorMessage';

/**
 * The axios interceptors reject plain-object AppErrors (NOT `instanceof
 * Error`), so `errorMessage` must recognise them by shape and resolve the
 * backend code to its dedicated translation when one exists.
 */
describe('errorMessage', () => {
  it('returns the message of a real Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns the fallback for non-error values', () => {
    expect(errorMessage('nope', 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage(null, 'fallback')).toBe('fallback');
  });

  it('returns the message of a plain-object AppError (interceptor rejection)', () => {
    const appError = { kind: 'forbidden', message: 'Godmode is disabled' };
    expect(errorMessage(appError, 'fallback')).toBe('Godmode is disabled');
  });

  it('resolves the backend code to its dedicated translation when available', () => {
    i18n.addResource(
      'en',
      'translation',
      'errors.codes.CLUB_006',
      'House creation limit reached (max 3).',
    );
    const appError = {
      kind: 'forbidden',
      code: 'CLUB_006',
      message: 'Club creation limit reached',
    };
    expect(errorMessage(appError, 'fallback')).toBe('House creation limit reached (max 3).');
  });

  it('falls back to the AppError message when the code has no translation', () => {
    const appError = { kind: 'forbidden', code: 'ZZZ_999', message: 'Backend message' };
    expect(errorMessage(appError, 'fallback')).toBe('Backend message');
  });

  it('falls back to the provided fallback when an AppError carries an empty message', () => {
    const appError = { kind: 'unknown', message: '' };
    expect(errorMessage(appError, 'fallback')).toBe('fallback');
  });
});
