const mockPost = jest.fn();

jest.mock('./apiClient', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

import { mediaService } from './mediaService';
import { voiceService } from './voiceService';

const originalFileReader = globalThis.FileReader;

describe('idempotent mobile uploads', () => {
  afterEach(() => {
    mockPost.mockReset();
    jest.restoreAllMocks();
    if (originalFileReader) {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: originalFileReader,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'FileReader');
    }
  });

  it('retries an avatar transport failure once with the exact same key and payload', async () => {
    mockPost
      .mockRejectedValueOnce({ kind: 'network', message: 'offline' })
      .mockResolvedValueOnce({ data: { data: { url: 'https://api.test/media/avatar/signed' } } });

    await expect(
      mediaService.uploadAvatar('cG5n', 'image/png', 'avatar-attempt-123'),
    ).resolves.toBe('https://api.test/media/avatar/signed');

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[1]).toEqual(mockPost.mock.calls[0]);
    expect(mockPost).toHaveBeenCalledWith(
      '/upload/avatar',
      { dataUrl: 'data:image/png;base64,cG5n' },
      { timeout: 60_000, headers: { 'Idempotency-Key': 'avatar-attempt-123' } },
    );
  });

  it('does not retry a deterministic avatar conflict', async () => {
    mockPost.mockRejectedValueOnce({ kind: 'conflict', status: 409, message: 'different bytes' });

    await expect(
      mediaService.uploadAvatar('cG5n', 'image/png', 'avatar-conflict-123'),
    ).rejects.toMatchObject({ kind: 'conflict', status: 409 });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('reuses one key and decoded payload when retrying a voice upload', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      blob: async () => ({}) as Blob,
    } as Response);
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: jest.fn(() => {
        const reader = {
          result: null as string | null,
          error: null,
          onloadend: null as (() => void) | null,
          onerror: null as (() => void) | null,
          readAsDataURL: () => {
            reader.result = 'data:audio/m4a;base64,dm9pY2U=';
            reader.onloadend?.();
          },
        };
        return reader;
      }),
    });
    mockPost
      .mockRejectedValueOnce({ kind: 'timeout', message: 'slow connection' })
      .mockResolvedValueOnce({ data: { data: { url: 'https://api.test/media/voice/signed' } } });

    await expect(voiceService.upload('file://clip.m4a', 'voice-attempt-123')).resolves.toBe(
      'https://api.test/media/voice/signed',
    );

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[1]).toEqual(mockPost.mock.calls[0]);
    expect(mockPost).toHaveBeenCalledWith(
      '/upload/voice',
      { base64: 'dm9pY2U=', mime: 'audio/m4a' },
      { timeout: 60_000, headers: { 'Idempotency-Key': 'voice-attempt-123' } },
    );
  });
});
