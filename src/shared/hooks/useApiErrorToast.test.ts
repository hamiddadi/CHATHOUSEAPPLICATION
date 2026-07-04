import { renderHook } from '@testing-library/react-native';
import { i18n } from '../../core/i18n';
import { toast } from '../components/Toast';
import { useApiErrorToast } from './useApiErrorToast';

jest.mock('../components/Toast', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

const handle = (err: unknown) => {
  const { result } = renderHook(() => useApiErrorToast());
  return result.current(err);
};

describe('useApiErrorToast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the localized generic for generic kinds instead of the raw backend message', () => {
    handle({ kind: 'server', status: 500, code: 'SERVER_001', message: 'Internal server error' });
    expect(toast.error).toHaveBeenCalledWith('Something went wrong on our end.');
  });

  it('maps a 429 axios error to the localized rate-limit message', () => {
    const err = Object.assign(new Error('Request failed with status code 429'), {
      isAxiosError: true,
      response: {
        status: 429,
        data: { success: false, error: { code: 'RATE_LIMIT_001', message: 'Too many requests' } },
      },
    });
    const e = handle(err);
    expect(e.kind).toBe('rateLimited');
    expect(toast.error).toHaveBeenCalledWith('Too many attempts. Please try again in a moment.');
  });

  it('keeps the backend-specific message for validation errors', () => {
    handle({
      kind: 'validation',
      status: 400,
      code: 'VALIDATION_001',
      message: 'Title too short',
      fields: { title: 'Too short' },
    });
    expect(toast.error).toHaveBeenCalledWith('Title too short');
  });

  it('resolves a stable backend code to its dedicated translation when available', () => {
    i18n.addResource(
      'en',
      'translation',
      'errors.codes.CHAT_004',
      'Direct messages are limited to people who follow each other.',
    );
    handle({
      kind: 'forbidden',
      status: 403,
      code: 'CHAT_004',
      message: 'Direct messages are limited to mutual follows',
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Direct messages are limited to people who follow each other.',
    );
  });

  it('keeps the backend message for specific kinds without a dedicated translation', () => {
    handle({ kind: 'forbidden', status: 403, message: 'Godmode is disabled' });
    expect(toast.error).toHaveBeenCalledWith('Godmode is disabled');
  });

  it('stays silent for auth errors but still returns the AppError', () => {
    const e = handle({ kind: 'auth', status: 401, message: 'Session expired' });
    expect(e.kind).toBe('auth');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
