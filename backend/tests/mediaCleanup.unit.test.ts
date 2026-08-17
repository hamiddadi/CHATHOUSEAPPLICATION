export {};

const mockWorkerConstructor = jest.fn();
const mockQueueConstructor = jest.fn();
const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn();
const mockQueueClose = jest.fn();
const mockGetRepeatableJobs = jest.fn();
const mockRemoveRepeatableByKey = jest.fn();
const mockQueueAdd = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('bullmq', () => ({
  Queue: mockQueueConstructor,
  Worker: mockWorkerConstructor,
}));
jest.mock('../src/queues/connection', () => ({ bullConnection: jest.fn(() => ({})) }));
jest.mock('../src/config/logger', () => ({
  logger: { error: mockLoggerError, info: jest.fn() },
}));
jest.mock('../src/modules/media/media.service', () => ({
  mediaService: { purgeAbandonedMedia: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { shutdownMediaCleanup, startMediaCleanupWorker } =
  require('../src/queues/mediaCleanup') as typeof import('../src/queues/mediaCleanup');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('media-cleanup worker startup lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerOn.mockReset();
    mockWorkerClose.mockReset().mockResolvedValue(undefined);
    mockQueueClose.mockReset().mockResolvedValue(undefined);
    mockGetRepeatableJobs.mockReset().mockResolvedValue([]);
    mockRemoveRepeatableByKey.mockReset().mockResolvedValue(undefined);
    mockQueueAdd.mockReset().mockResolvedValue(undefined);
    mockWorkerConstructor.mockReset().mockImplementation(() => ({
      close: mockWorkerClose,
      on: mockWorkerOn,
    }));
    mockQueueConstructor.mockReset().mockImplementation(() => ({
      add: mockQueueAdd,
      close: mockQueueClose,
      getRepeatableJobs: mockGetRepeatableJobs,
      removeRepeatableByKey: mockRemoveRepeatableByKey,
    }));
  });

  afterEach(async () => {
    await shutdownMediaCleanup().catch(() => undefined);
  });

  it.each(['enumerate', 'remove', 'register'] as const)(
    'closes and forgets both resources when repeat-job %s fails',
    async failurePoint => {
      const startupError = new Error(`${failurePoint} failed`);
      if (failurePoint === 'enumerate') {
        mockGetRepeatableJobs.mockRejectedValueOnce(startupError);
      } else if (failurePoint === 'remove') {
        mockGetRepeatableJobs.mockResolvedValueOnce([
          { key: 'repeat-key', name: 'purge-abandoned-media' },
        ]);
        mockRemoveRepeatableByKey.mockRejectedValueOnce(startupError);
      } else {
        mockQueueAdd.mockRejectedValueOnce(startupError);
      }

      await expect(startMediaCleanupWorker()).rejects.toBe(startupError);
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);

      mockGetRepeatableJobs.mockResolvedValue([]);
      mockRemoveRepeatableByKey.mockResolvedValue(undefined);
      mockQueueAdd.mockResolvedValue(undefined);
      await expect(startMediaCleanupWorker()).resolves.toBeDefined();
      expect(mockWorkerConstructor).toHaveBeenCalledTimes(2);
      expect(mockQueueConstructor).toHaveBeenCalledTimes(2);
    },
  );

  it('resets both singletons even when one startup rollback close rejects', async () => {
    const startupError = new Error('repeat lookup failed');
    mockGetRepeatableJobs.mockRejectedValueOnce(startupError);
    mockWorkerClose.mockRejectedValueOnce(new Error('worker close failed'));

    await expect(startMediaCleanupWorker()).rejects.toBe(startupError);
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'media-cleanup startup rollback failed',
      expect.objectContaining({ reason: 'Failed to close media-cleanup resources' }),
    );

    mockGetRepeatableJobs.mockResolvedValue([]);
    await expect(startMediaCleanupWorker()).resolves.toBeDefined();
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(2);
    expect(mockQueueConstructor).toHaveBeenCalledTimes(2);
  });

  it('does not let a hung resource close suppress the original startup failure', async () => {
    jest.useFakeTimers();
    try {
      const startupError = new Error('repeat lookup failed');
      mockGetRepeatableJobs.mockRejectedValueOnce(startupError);
      mockWorkerClose.mockReturnValueOnce(new Promise<void>(() => undefined));

      const startupAssertion = expect(startMediaCleanupWorker()).rejects.toBe(startupError);
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      await startupAssertion;
      expect(mockWorkerClose).toHaveBeenCalledWith(true);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'media-cleanup startup rollback failed',
        expect.objectContaining({ reason: 'Timed out closing media-cleanup resources' }),
      );

      mockGetRepeatableJobs.mockResolvedValue([]);
      await expect(startMediaCleanupWorker()).resolves.toBeDefined();
      expect(mockWorkerConstructor).toHaveBeenCalledTimes(2);
      expect(mockQueueConstructor).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
