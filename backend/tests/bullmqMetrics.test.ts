import type { BullMqQueueMetricsSource } from '../src/monitoring/bullmqMetrics';
import {
  BULLMQ_JOB_STATES,
  collectBullMqJobMetrics,
  startBullMqMetricsCollector,
  stopBullMqMetricsCollector,
} from '../src/monitoring/bullmqMetrics';
import { bullmqJobsGauge } from '../src/monitoring/metrics';

const source = (
  name: string,
  counts: Record<string, number> | Error,
): BullMqQueueMetricsSource => ({
  name,
  getJobCounts: jest.fn().mockImplementation(async () => {
    if (counts instanceof Error) throw counts;
    return counts;
  }),
});

describe('BullMQ Prometheus collector', () => {
  beforeEach(() => {
    bullmqJobsGauge.reset();
    stopBullMqMetricsCollector();
  });

  afterEach(() => {
    stopBullMqMetricsCollector();
    jest.useRealTimers();
  });

  it('publishes every bounded queue/state label and defaults absent counts to zero', async () => {
    const queue = source('event-reminders', {
      waiting: 2,
      active: 1,
      failed: 3,
      delayed: 4,
    });

    await collectBullMqJobMetrics([queue]);

    expect(queue.getJobCounts).toHaveBeenCalledWith(...BULLMQ_JOB_STATES);
    const metric = await bullmqJobsGauge.get();
    const values = new Map(
      metric.values.map(sample => [String(sample.labels.state), sample.value]),
    );
    expect(values).toEqual(
      new Map([
        ['waiting', 2],
        ['active', 1],
        ['completed', 0],
        ['failed', 3],
        ['delayed', 4],
      ]),
    );
  });

  it('keeps collecting healthy queues when another Redis read fails', async () => {
    const healthy = source('location-purge', { waiting: 1 });

    await expect(
      collectBullMqJobMetrics([source('unavailable', new Error('redis unavailable')), healthy]),
    ).resolves.toBeUndefined();

    const metric = await bullmqJobsGauge.get();
    expect(
      metric.values.some(
        sample => sample.labels.queue === 'location-purge' && sample.labels.state === 'waiting',
      ),
    ).toBe(true);
    expect(metric.values.some(sample => sample.labels.queue === 'unavailable')).toBe(false);
  });

  it('starts once, polls without duplicate timers, and stops cleanly', async () => {
    jest.useFakeTimers();
    const queue = source('gdpr-purge', { waiting: 0 });

    startBullMqMetricsCollector([queue], 1_000);
    startBullMqMetricsCollector([queue], 1_000);
    expect(queue.getJobCounts).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(queue.getJobCounts).toHaveBeenCalledTimes(2);

    stopBullMqMetricsCollector();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(queue.getJobCounts).toHaveBeenCalledTimes(2);
  });
});
