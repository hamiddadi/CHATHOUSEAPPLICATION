/**
 * Unit test for useVoiceMessage's error routing. A 403 on a voice send is the
 * DM privacy gate (CHAT_004 — the same rule the text send hits), so it must
 * surface the dedicated "message impossible" Alert, NOT a generic error toast.
 * Non-forbidden failures still fall through to the toast.
 */
import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
// The module under test. jest.mock calls below are hoisted above every import,
// so the mocks are registered before this module's dependencies resolve.
import { useVoiceMessage } from './useVoiceMessage';

// Recorder always yields a clip so sendRecording proceeds to upload + send.
// `mock`-prefixed so the jest.mock factory may reference it (jest hoisting rule).
const mockFinish = jest.fn(async () => ({ uri: 'file://clip.m4a', durationMs: 1200 }));
jest.mock('./useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    isRecording: false,
    isPreparing: false,
    elapsedMs: 0,
    start: jest.fn(async () => true),
    finish: mockFinish,
    cancel: jest.fn(),
  }),
}));

// Upload always succeeds — we drive the outcome via the injected `send`.
jest.mock('../../../shared/services/api/voiceService', () => ({
  voiceService: { upload: jest.fn(async () => 'https://cdn.test/clip.m4a') },
}));

const mockToastError = jest.fn();
jest.mock('../../../shared/hooks/useApiErrorToast', () => ({
  useApiErrorToast: () => mockToastError,
}));

describe('useVoiceMessage error routing', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('a 403 (CHAT_004) voice send shows the privacy Alert, not a toast', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    // A normalized forbidden AppError, exactly what the interceptor rejects with.
    const send = jest.fn(async () => {
      throw { kind: 'forbidden', status: 403, code: 'CHAT_004', message: 'blocked' };
    });
    const { result } = renderHook(() => useVoiceMessage(send));

    await act(async () => {
      await result.current.sendRecording();
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    // The privacy alert is shown with a title + body (localized; we assert
    // both are non-empty strings rather than pinning a language), and crucially
    // the generic error toast is NOT used for this gate.
    expect(typeof alertSpy.mock.calls[0]![0]).toBe('string');
    expect((alertSpy.mock.calls[0]![0] as string).length).toBeGreaterThan(0);
    expect(typeof alertSpy.mock.calls[0]![1]).toBe('string');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('a non-forbidden failure falls through to the error toast', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const send = jest.fn(async () => {
      throw { kind: 'server', status: 500, message: 'boom' };
    });
    const { result } = renderHook(() => useVoiceMessage(send));

    await act(async () => {
      await result.current.sendRecording();
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
