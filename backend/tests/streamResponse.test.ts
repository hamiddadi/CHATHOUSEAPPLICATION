import { Writable } from 'node:stream';
import type { Response } from 'express';
import { preflightResponseChunks, streamResponseChunks } from '../src/utils/streamResponse';

describe('streamResponseChunks', () => {
  it('performs one producer step before exposing the prepared stream', async () => {
    let setupRuns = 0;
    const chunks = async function* () {
      setupRuns += 1;
      yield 'header';
      yield 'row';
    };

    const prepared = await preflightResponseChunks(chunks());

    expect(setupRuns).toBe(1);
    const output: string[] = [];
    for await (const chunk of prepared) output.push(chunk);
    expect(output).toEqual(['header', 'row']);
  });

  it('honours writable backpressure instead of eagerly consuming the producer', async () => {
    let produced = 0;
    let written = 0;
    let largestLead = 0;
    const chunks = async function* () {
      for (let index = 0; index < 1_000; index += 1) {
        produced += 1;
        largestLead = Math.max(largestLead, produced - written);
        yield 'x'.repeat(1_024);
      }
    };
    const sink = new Writable({
      highWaterMark: 2_048,
      write(_chunk, _encoding, callback) {
        setImmediate(() => {
          written += 1;
          callback();
        });
      },
    });

    await streamResponseChunks(sink as unknown as Response, chunks());

    expect(written).toBe(1_000);
    expect(largestLead).toBeLessThan(20);
  });

  it('cancels the producer cleanly when the client abandons the response', async () => {
    let finalized = false;
    const chunks = async function* () {
      try {
        for (;;) yield 'download-chunk';
      } finally {
        finalized = true;
      }
    };
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
        const disconnected = new Error('client disconnected') as NodeJS.ErrnoException;
        disconnected.code = 'ECONNRESET';
        this.destroy(disconnected);
      },
    });

    await expect(
      streamResponseChunks(sink as unknown as Response, chunks()),
    ).resolves.toBeUndefined();
    expect(finalized).toBe(true);
  });

  it('propagates producer failures even after pipeline destroys the response', async () => {
    const chunks = async function* () {
      yield 'partial-response';
      throw new Error('database unavailable');
    };
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(streamResponseChunks(sink as unknown as Response, chunks())).rejects.toThrow(
      'database unavailable',
    );
  });
});
